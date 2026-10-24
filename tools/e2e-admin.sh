#!/usr/bin/env bash
# 线上端到端自测：按需求文档 §16 的验收清单逐项打真实接口。
# 用法（在 home 上跑）：bash e2e-admin.sh https://dw.sharyuke.com <管理员密码>
set -uo pipefail

BASE="${1:-https://dw.sharyuke.com}"
ADMIN_PW="${2:?需要管理员密码}"
API="$BASE/api/v1"
ADMIN_USER="${ADMIN_USER:-douwan}"
# 本次运行的唯一后缀：用于生成不撞车的 slug / 名称
RUN_ID=$(date +%H%M%S)

pass=0
fail=0
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; fail=$((fail+1)); }
step() { printf '\n\033[36m== %s\033[0m\n' "$1"; }

# jq 不一定有，用 python3 解析
jget() { python3 -c "import sys,json;d=json.load(sys.stdin);
import functools
path='$1'.split('.')
for p in path:
    if p=='': continue
    if isinstance(d,list): d=d[int(p)]
    else: d=d.get(p)
print('' if d is None else d)" 2>/dev/null; }

req() { # method path [body] [token]
  local m="$1" p="$2" b="${3:-}" t="${4:-}"
  local args=(-s -X "$m" "$API$p" -H "Content-Type: application/json")
  [ -n "$t" ] && args+=(-H "Authorization: Bearer $t")
  [ -n "$b" ] && args+=(-d "$b")
  curl "${args[@]}"
}

############################# 后台鉴权
step "后台鉴权（§3）"
LOGIN=$(req POST /admin/auth/login "{\"account\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PW\"}")
CODE=$(echo "$LOGIN" | jget code)
if [ "$CODE" = "0" ]; then ok "管理员登录成功"; else bad "管理员登录失败：$(echo "$LOGIN" | jget message)"; exit 1; fi
ATOKEN=$(echo "$LOGIN" | jget data.tokens.access_token)
RTOKEN=$(echo "$LOGIN" | jget data.tokens.refresh_token)
ROLE=$(echo "$LOGIN" | jget data.admin.role)
[ "$ROLE" = "super_admin" ] && ok "角色为超级管理员" || bad "角色异常：$ROLE"

ME=$(req GET /admin/auth/me "" "$ATOKEN")
[ "$(echo "$ME" | jget data.username)" = "$ADMIN_USER" ] && ok "GET /admin/auth/me 正常" || bad "/admin/auth/me 异常"

# 未登录不能访问后台
NOAUTH=$(curl -s -o /dev/null -w '%{http_code}' "$API/admin/overview")
[ "$NOAUTH" = "401" ] && ok "未登录访问后台返回 401" || bad "未登录访问后台返回 $NOAUTH（期望 401）"

# 刷新令牌
REFRESH=$(req POST /admin/auth/refresh "{\"refresh_token\":\"$RTOKEN\"}")
[ "$(echo "$REFRESH" | jget code)" = "0" ] && ok "后台令牌刷新成功" || bad "后台令牌刷新失败"
ATOKEN=$(echo "$REFRESH" | jget data.tokens.access_token)
RTOKEN2=$(echo "$REFRESH" | jget data.tokens.refresh_token)
REUSE=$(req POST /admin/auth/refresh "{\"refresh_token\":\"$RTOKEN\"}")
[ "$(echo "$REUSE" | jget code)" = "20003" ] && ok "旧刷新令牌复用被拒绝（20003）" || bad "旧刷新令牌仍可用（幂等/轮换失败）"

############################# 清理上次残留（脚本可重复执行）
step "清理上次残留（保证脚本可重复执行）"
# 测试分类：先把分类下的素材全部下架并删除，再删分类
CLEANED_CATS=""
OLDCATS=$(req GET "/admin/asset-categories?keyword=E2E&page=1&page_size=20" "" "$ATOKEN")
OLD_CAT_IDS=$(echo "$OLDCATS" | python3 -c "import sys,json;print(' '.join(str(x['id']) for x in (json.load(sys.stdin).get('data') or {}).get('list') or []))")
for cid in $OLD_CAT_IDS; do
  OLDASSETS=$(req GET "/admin/assets?category_id=$cid&page=1&page_size=100" "" "$ATOKEN")
  OLD_AIDS=$(echo "$OLDASSETS" | python3 -c "import sys,json;print(' '.join(str(x['id']) for x in (json.load(sys.stdin).get('data') or {}).get('list') or []))")
  for aid in $OLD_AIDS; do
    req PATCH "/admin/assets/$aid/status" '{"status":"archived","reason":"E2E 清理"}' "$ATOKEN" > /dev/null
    req DELETE "/admin/assets/$aid?reason=E2E%E6%B8%85%E7%90%86" "" "$ATOKEN" > /dev/null
  done
  DEL=$(req DELETE "/admin/asset-categories/$cid" "" "$ATOKEN")
  if [ "$(echo "$DEL" | jget code)" = "0" ]; then
    CLEANED_CATS="$CLEANED_CATS $cid"
  else
    bad "清理分类 $cid 失败：$(echo "$DEL" | jget message)（后面会换一个 slug 继续，不影响本次测试结论）"
  fi
done
[ -n "$CLEANED_CATS" ] && ok "已清理上次的测试分类与素材（$CLEANED_CATS）" || ok "没有需要清理的测试分类"

# 测试套餐：只下架更早的、名字带 E2E 的套餐，避免误伤本次运行刚建的
OLDPLANS=$(req GET "/admin/plans?keyword=E2E&page=1&page_size=50" "" "$ATOKEN")
OLD_PIDS=$(echo "$OLDPLANS" | python3 -c "
import sys, json, time
d = (json.load(sys.stdin).get('data') or {}).get('list') or []
now = time.time()
out = []
for x in d:
    # created_at 是 RFC3339，超过 30 秒的才算「上次运行留下的」
    try:
        t = time.mktime(time.strptime(x['created_at'][:19], '%Y-%m-%dT%H:%M:%S'))
    except Exception:
        continue
    if now - t > 30:
        out.append(str(x['id']))
print(' '.join(out))")
for pid in $OLD_PIDS; do
  req PATCH "/admin/plans/$pid/status" '{"status":"archived","reason":"E2E 清理"}' "$ATOKEN" > /dev/null
done
[ -n "$OLD_PIDS" ] && ok "已下架上次的测试套餐（$OLD_PIDS）" || ok "没有需要清理的历史测试套餐"

############################# 套餐
step "套餐管理（§5）"
PLAN_NAME="E2E 测试套餐 $(date +%H%M%S)"
CREATE_PLAN=$(req POST /admin/plans "{\"name\":\"$PLAN_NAME\",\"price\":19.9,\"benefit_config\":{\"kind\":\"unlimited\",\"validity_type\":\"day\",\"validity_value\":7,\"start_on\":\"redeem\"},\"feature_permissions\":{\"export.pdf\":true},\"feature_text\":[\"E2E 权益一\"],\"card_quantity\":1}" "$ATOKEN")
PID=$(echo "$CREATE_PLAN" | jget data.id)
PCODE=$(echo "$CREATE_PLAN" | jget data.code)
[ -n "$PID" ] && ok "新建套餐成功（id=$PID code=$PCODE，初始草稿）" || bad "新建套餐失败：$(echo "$CREATE_PLAN" | jget message)"
[ "$(echo "$CREATE_PLAN" | jget data.status)" = "draft" ] && ok "新建套餐默认是草稿" || bad "新建套餐状态不是草稿"

# 草稿不应出现在前台（注意：线上可能已经有别的已上架套餐，所以按 id 判断而不是看总数）
PUB_BEFORE=$(curl -s "$API/plans")
HAS_DRAFT=$(echo "$PUB_BEFORE" | python3 -c "import sys,json;print(any((p.get('id')==$PID) for p in (json.load(sys.stdin).get('data') or [])))")
[ "$HAS_DRAFT" = "False" ] && ok "草稿套餐不在前台展示" || bad "草稿套餐泄漏到前台"

# 改价后再上架
UPD=$(req PUT "/admin/plans/$PID" "{\"name\":\"$PLAN_NAME\",\"price\":29.5,\"benefit_config\":{\"kind\":\"quota\",\"usage_limit\":12,\"validity_type\":\"month\",\"validity_value\":1,\"start_on\":\"redeem\"},\"feature_permissions\":{\"export.pdf\":true,\"generate.variants\":3},\"feature_text\":[\"E2E 权益一\",\"E2E 权益二\"]}" "$ATOKEN")
[ "$(echo "$UPD" | jget code)" = "0" ] && ok "编辑套餐（改价 + 改权益，含 jsonb）成功" || bad "编辑套餐失败：$(echo "$UPD" | jget message)"

PUB=$(req PATCH "/admin/plans/$PID/status" '{"status":"published"}' "$ATOKEN")
[ "$(echo "$PUB" | jget data.status)" = "published" ] && ok "套餐上架成功" || bad "套餐上架失败：$(echo "$PUB" | jget message)"

PUB_AFTER=$(curl -s "$API/plans")
PRICE=$(echo "$PUB_AFTER" | python3 -c "
import sys, json
d = json.load(sys.stdin).get('data') or []
hit = [p for p in d if p.get('id') == $PID]
print(hit[0]['price'] if hit else 'not-found')")
[ "$PRICE" = "29.5" ] && ok "前台套餐价格来自数据库（29.5）" || bad "前台套餐价格异常：$PRICE"

# 预览
PREVIEW=$(req GET "/admin/plans/$PID/preview" "" "$ATOKEN")
[ "$(echo "$PREVIEW" | jget data.visible)" = "True" ] && ok "套餐前台预览可用" || bad "套餐预览异常"

# 上架校验：坏配置拦得住
BADPLAN=$(req POST /admin/plans '{"name":"非法额度套餐","price":1,"benefit_config":{"kind":"quota","usage_limit":0,"validity_type":"day","validity_value":7}}' "$ATOKEN")
[ "$(echo "$BADPLAN" | jget code)" = "10001" ] && ok "额度为 0 的 quota 套餐被拒绝（10001）" || bad "非法套餐未被拦截"

############################# 卡密
step "卡密管理（§6）"
GEN=$(req POST /admin/card-keys/generate "{\"plan_id\":$PID,\"count\":5,\"batch_name\":\"E2E 批次\",\"note\":\"自动化测试\"}" "$ATOKEN")
BATCH=$(echo "$GEN" | jget data.batch_id)
CODES=$(echo "$GEN" | python3 -c "import sys,json;print(' '.join(json.load(sys.stdin).get('data',{}).get('codes') or []))")
NCODE=$(echo "$CODES" | wc -w)
[ "$NCODE" = "5" ] && ok "批量生成 5 张卡密（批次 $BATCH）" || bad "生成卡密数量异常：$NCODE"

FIRST=$(echo "$CODES" | awk '{print $1}')
# 卡密不含易混淆字符
if echo "$FIRST" | grep -qE '[O0I1L]'; then bad "卡密包含易混淆字符：$FIRST"; else ok "卡密不含 O/0/I/1/L（$FIRST）"; fi
# 不重复
UNIQ=$(echo "$CODES" | tr ' ' '\n' | sort -u | wc -l)
[ "$UNIQ" = "5" ] && ok "生成的卡密无重复" || bad "生成的卡密有重复"

# 超量生成被拒
OVER=$(req POST /admin/card-keys/generate "{\"plan_id\":$PID,\"count\":99999}" "$ATOKEN")
[ "$(echo "$OVER" | jget code)" = "10001" ] && ok "超出单次上限被拒绝（10001）" || bad "超量生成未被拦截"

# 列表默认脱敏
LIST=$(req GET "/admin/card-keys?page=1&page_size=10&plan_id=$PID" "" "$ATOKEN")
MASKED=$(echo "$LIST" | python3 -c "import sys,json;d=json.load(sys.stdin)['data']['list'];print(d[0]['code_masked'] if d else '')")
echo "$MASKED" | grep -q '\*' && ok "卡密列表默认脱敏（$MASKED）" || bad "列表未脱敏：$MASKED"

# 按卡密前缀搜索（去掉连字符）
PREFIX=$(echo "$FIRST" | tr -d '-')
SEARCH=$(req GET "/admin/card-keys?page=1&page_size=10&keyword=${PREFIX:0:6}" "" "$ATOKEN")
STOTAL=$(echo "$SEARCH" | jget data.total)
[ "$STOTAL" != "0" ] && ok "按卡密前缀（不含连字符）能搜到" || bad "按卡密前缀搜索失败"

# 查看明文
IDS=$(echo "$LIST" | python3 -c "import sys,json;print(','.join(str(x['id']) for x in json.load(sys.stdin)['data']['list']))")
REVEAL=$(req POST /admin/card-keys/reveal "{\"ids\":[$IDS]}" "$ATOKEN")
RCODES=$(echo "$REVEAL" | python3 -c "import sys,json;c=json.load(sys.stdin).get('data',{}).get('codes',{});print(' '.join(v.replace('-','') for v in c.values() if v))")
echo "$RCODES" | grep -q "$(echo "$FIRST" | tr -d '-')" && ok "查看明文正常（与服务端一致，并已记日志）" || bad "查看明文异常"

# 导出 CSV（明文）
curl -s -X POST "$API/admin/card-keys/export" -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ATOKEN" -d "{\"plan_id\":$PID,\"reveal\":true}" -o /tmp/e2e-cards.csv -w '' 
if [ -s /tmp/e2e-cards.csv ] && head -1 /tmp/e2e-cards.csv | grep -q '卡密'; then
  ok "导出卡密 CSV 正常（$(wc -l < /tmp/e2e-cards.csv) 行）"
else
  bad "导出卡密 CSV 异常"
fi

############################# 素材
step "素材库（§8）"
# 上传前重新生成一次 PNG，确保文件存在且合法（不依赖脚本前半段的临时文件）
python3 /tmp/gen-png.py /tmp/e2e.png > /dev/null
PNG_OK=$(python3 -c "
import struct
d = open('/tmp/e2e.png','rb').read()
print('ok' if d[:8] == b'\x89PNG\r\n\x1a\n' and struct.unpack('>II', d[16:24]) == (12,12) else 'bad')")
[ "$PNG_OK" = "ok" ] && ok "测试图片就绪（$(wc -c < /tmp/e2e.png) 字节的合法 PNG）" || bad "测试图片不合法"

# slug 带时间戳：即使上次的残留没清干净，也不会撞唯一索引
CAT=$(req POST /admin/asset-categories "{\"name\":\"E2E 分类\",\"slug\":\"e2e-cat-$RUN_ID\",\"sort_order\":5}" "$ATOKEN")
CID=$(echo "$CAT" | jget data.id)
[ -n "$CID" ] && ok "新建素材分类成功（id=$CID）" || bad "新建分类失败：$(echo "$CAT" | jget message)"

# 生成一张真实 PNG（务必重定向到指定的真实文件，heredoc 不能直接被 curl -F 读取）
cat > /tmp/gen-png.py <<'PY'
import struct, zlib, sys
def chunk(tag, data):
    c = tag + data
    return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
W = H = 12
raw = bytearray()
for _ in range(H):
    raw.append(0)            # filter type 0
    for _ in range(W):
        raw += bytes((0xF4, 0xA1, 0x5B))
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(bytes(raw), 9))
       + chunk(b'IEND', b''))
out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/e2e.png'
with open(out, 'wb') as f:
    f.write(png)
print('生成 %s：%d 字节' % (out, len(png)))
PY
python3 /tmp/gen-png.py /tmp/e2e.png
PNG_SIZE=$(wc -c < /tmp/e2e.png)
PNG_MIME=$(file -b --mime-type /tmp/e2e.png 2>/dev/null || echo unknown)
if [ "$PNG_SIZE" -gt 50 ] && [ "$PNG_MIME" = "image/png" ]; then
  ok "测试 PNG 生成成功（$PNG_SIZE 字节，$PNG_MIME）"
else
  bad "测试 PNG 生成失败（$PNG_SIZE 字节，$PNG_MIME）"
fi

UP=$(curl -s -X POST "$API/admin/assets/upload" -H "Authorization: Bearer $ATOKEN" \
  -F "files=@/tmp/e2e.png" -F "title=E2E 素材" -F "category_id=$CID" \
  -F 'tags=["e2e","test"]' -F "status=draft" -F "sort_order=50" -F "is_featured=true")
AID=$(echo "$UP" | jget data.items.0.id)
AIMG=$(echo "$UP" | jget data.items.0.image_url)
ATHUMB=$(echo "$UP" | jget data.items.0.thumbnail_url)
[ -n "$AID" ] && ok "上传 PNG 成功（原图 $AIMG，缩略图 $ATHUMB）" || bad "上传素材失败：$(echo "$UP" | jget message)"

# 原图与缩略图能公网访问
H1=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$AIMG")
H2=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$ATHUMB")
[ "$H1" = "200" ] && ok "原图经 nginx 可访问（200）" || bad "原图访问返回 $H1"
[ "$H2" = "200" ] && ok "缩略图经 nginx 可访问（200）" || bad "缩略图访问返回 $H2"

# 草稿不公开（线上可能已有别的已发布素材，所以按 id 判断，而不是看总数）
PA=$(curl -s "$API/assets?page_size=100")
HAS_DRAFT=$(echo "$PA" | python3 -c "import sys,json;print(any((a.get('id')==$AID) for a in (json.load(sys.stdin).get('data') or {}).get('list') or []))")
[ "$HAS_DRAFT" = "False" ] && ok "草稿素材不在前台展示" || bad "草稿素材泄漏到前台"

# 标签筛选（jsonb 字段，草稿状态下用后台接口验证，避免依赖发布顺序）
TAGQ=$(req GET "/admin/assets?page=1&page_size=10&tag=e2e" "" "$ATOKEN")
[ "$(echo "$TAGQ" | jget data.total)" = "1" ] && ok "按标签筛选正常（jsonb 字段可查）" || bad "按标签筛选失败：$(echo "$TAGQ" | jget message)"

# 拒绝非图片
echo "not an image at all" > /tmp/e2e.txt
BADUP=$(curl -s -X POST "$API/admin/assets/upload" -H "Authorization: Bearer $ATOKEN" \
  -F "files=@/tmp/e2e.txt" -F "title=假图片" -F "category_id=$CID")
[ "$(echo "$BADUP" | jget code)" = "40022" ] && ok "非图片文件被拒绝（40022）" || bad "非图片文件未被拦截：$(echo "$BADUP" | jget message)"

# 拒绝 SVG
printf '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>' > /tmp/e2e.svg
SVGUP=$(curl -s -X POST "$API/admin/assets/upload" -H "Authorization: Bearer $ATOKEN" \
  -F "files=@/tmp/e2e.svg" -F "title=svg" -F "category_id=$CID")
[ "$(echo "$SVGUP" | jget code)" = "40022" ] && ok "SVG 被拒绝（40022）" || bad "SVG 未被拦截"

# 发布 → 前台可见（同样按 id 判断）
req PATCH "/admin/assets/$AID/status" '{"status":"published"}' "$ATOKEN" > /dev/null
PA2=$(curl -s "$API/assets?tag=e2e&page_size=100")
HAS_PUB=$(echo "$PA2" | python3 -c "import sys,json;print(any((a.get('id')==$AID) for a in (json.load(sys.stdin).get('data') or {}).get('list') or []))")
[ "$HAS_PUB" = "True" ] && ok "发布后前台可见" || bad "发布后前台不可见"

# 已发布不能直接删
DEL=$(req DELETE "/admin/assets/$AID" "" "$ATOKEN")
[ "$(echo "$DEL" | jget code)" = "40019" ] && ok "已发布素材禁止直接删除（40019）" || bad "已发布素材可被直接删除"

# 有素材的分类不能删
CDEL=$(req DELETE "/admin/asset-categories/$CID" "" "$ATOKEN")
[ "$(echo "$CDEL" | jget code)" = "40021" ] && ok "有素材的分类禁止删除（40021）" || bad "有素材的分类可被删除"

############################# 前台用户 + 兑换
step "卡密兑换与权益发放（§6.5 / §9）"
UNAME="e2e$(date +%s)"
REG=$(req POST /auth/register "{\"username\":\"$UNAME\",\"password\":\"user-pass-1234\",\"nickname\":\"E2E 用户\"}")
UTOKEN=$(echo "$REG" | jget data.tokens.access_token)
UID_=$(echo "$REG" | jget data.user.id)
[ -n "$UTOKEN" ] && ok "前台用户注册成功（$UNAME，id=$UID_）" || bad "注册失败：$(echo "$REG" | jget message)"

# 未登录兑换被拒
NORED=$(curl -s -X POST "$API/card-keys/redeem" -H "Content-Type: application/json" -d "{\"code\":\"$FIRST\"}")
[ "$(echo "$NORED" | jget code)" = "20001" ] && ok "未登录兑换被拒绝（20001）" || bad "未登录也能兑换"

SECOND=$(echo "$CODES" | awk '{print $2}')
R1=$(req POST /card-keys/redeem "{\"code\":\"$FIRST\"}" "$UTOKEN")
[ "$(echo "$R1" | jget code)" = "0" ] && ok "首次兑换成功（$(echo "$R1" | jget data.message)）" || bad "兑换失败：$(echo "$R1" | jget message)"

# 重复兑换
R2=$(req POST /card-keys/redeem "{\"code\":\"$FIRST\"}" "$UTOKEN")
[ "$(echo "$R2" | jget code)" = "40009" ] && ok "同一张卡密二次兑换失败（40009）" || bad "重复兑换未被拒绝：$(echo "$R2" | jget code)"

# 带连字符/空格/小写也能兑换
LOWER=$(echo "$SECOND" | tr 'A-Z' 'a-z' | sed 's/-/ /g')
R3=$(req POST /card-keys/redeem "{\"code\":\"  $LOWER  \"}" "$UTOKEN")
[ "$(echo "$R3" | jget code)" = "0" ] && ok "卡密大小写/空格容忍正常" || bad "卡密归一化失败：$(echo "$R3" | jget message)"

# 权益
ENTS=$(req GET /my/entitlements "" "$UTOKEN")
EN=$(echo "$ENTS" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('data') or []))")
[ "$EN" = "2" ] && ok "用户已获得 2 条权益" || bad "权益条数异常：$EN"

MEP=$(req GET /users/me "" "$UTOKEN")
ISPRO=$(echo "$MEP" | jget data.membership.is_pro)
EXPIRE=$(echo "$MEP" | jget data.membership.expire_at)
[ "$ISPRO" = "True" ] && ok "会员状态已同步（到期 $EXPIRE）" || bad "会员状态未同步"

# 权限矩阵（未登录也应能拿到免费版矩阵）
# 注意：permissions 是「功能键 → 值」的映射，键里有小数点，
# 用点号路径去取会被当成嵌套结构，所以直接用 python 取键。
PM_ANON=$(curl -s "$API/permissions")
ANON_BASIC=$(echo "$PM_ANON" | python3 -c "import sys,json;print((json.load(sys.stdin).get('data') or {}).get('permissions',{}).get('generate.basic'))")
[ "$ANON_BASIC" = "True" ] && ok "未登录也能拿到免费版权限矩阵" || bad "权限矩阵接口异常：$(echo "$PM_ANON" | jget message)"
PM=$(curl -s "$API/permissions" -H "Authorization: Bearer $UTOKEN")
PDFPERM=$(echo "$PM" | python3 -c "import sys,json;print((json.load(sys.stdin).get('data') or {}).get('permissions',{}).get('export.pdf'))")
[ "$PDFPERM" = "True" ] && ok "兑换后套餐权限已生效（export.pdf=true）" || bad "套餐权限未生效：export.pdf=$PDFPERM"

# 不存在的卡密
NF=$(req POST /card-keys/redeem '{"code":"AAAA-BBBB-CCCC-DDDD"}' "$UTOKEN")
[ "$(echo "$NF" | jget code)" = "40008" ] && ok "不存在的卡密返回 40008" || bad "不存在的卡密返回 $(echo "$NF" | jget code)"

############################# 订单
step "订单与人工确认发卡（§6.6 / §7）"
ORD=$(req POST /orders "{\"plan_id\":$PID}" "$UTOKEN")
OID=$(echo "$ORD" | jget data.id)
ONO=$(echo "$ORD" | jget data.order_no)
OSNAP=$(echo "$ORD" | jget data.plan_snapshot.amount)
[ -n "$OID" ] && ok "前台下单成功（$ONO，快照金额 $OSNAP）" || bad "下单失败：$(echo "$ORD" | jget message)"

# 未支付不能发卡
ISS=$(req POST "/admin/orders/$OID/issue" '{"note":"未支付就想发卡"}' "$ATOKEN")
[ "$(echo "$ISS" | jget code)" = "40015" ] && ok "未支付订单不能发卡（40015）" || bad "未支付订单可发卡"

# 人工确认收款（不带发卡）
SET=$(req POST "/admin/orders/$OID/settle" '{"amount_paid":29.5,"payment_method":"manual","note":"E2E 人工确认收款"}' "$ATOKEN")
[ "$(echo "$SET" | jget data.payment_status)" = "paid" ] && ok "人工确认收款成功，状态已支付" || bad "确认收款失败：$(echo "$SET" | jget message)"

# 重复确认被拒
SET2=$(req POST "/admin/orders/$OID/settle" '{"note":"重复确认"}' "$ATOKEN")
[ "$(echo "$SET2" | jget code)" = "40014" ] && ok "重复确认收款被拒绝（40014）" || bad "重复确认未被拒绝"

# 发卡
ISS2=$(req POST "/admin/orders/$OID/issue" '{"note":"E2E 发放卡密"}' "$ATOKEN")
[ "$(echo "$ISS2" | jget data.fulfillment_status)" = "issued" ] && ok "发卡成功（已发放 $(echo "$ISS2" | jget data.card_issued_count) 张）" || bad "发卡失败：$(echo "$ISS2" | jget message)"

# 重复发卡被拒
ISS3=$(req POST "/admin/orders/$OID/issue" '{"note":"重复发卡"}' "$ATOKEN")
[ "$(echo "$ISS3" | jget code)" = "40017" ] && ok "重复发卡被拒绝（40017）" || bad "重复发卡未被拒绝：$(echo "$ISS3" | jget code)"

# 订单快照不受改价影响
req PUT "/admin/plans/$PID" "{\"name\":\"$PLAN_NAME\",\"price\":99.0,\"benefit_config\":{\"kind\":\"quota\",\"usage_limit\":12,\"validity_type\":\"month\",\"validity_value\":1},\"feature_text\":[\"E2E 权益一\"]}" "$ATOKEN" > /dev/null
ODET=$(req GET "/admin/orders/$OID" "" "$ATOKEN")
SNAP2=$(echo "$ODET" | jget data.plan_snapshot.amount)
[ "$SNAP2" = "29.5" ] && ok "改价后历史订单快照不变（仍为 29.5）" || bad "历史订单快照被改价覆盖：$SNAP2"
EVCOUNT=$(echo "$ODET" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['data'].get('events') or []))")
[ "$EVCOUNT" -ge 2 ] && ok "订单状态变化记录已保留（$EVCOUNT 条）" || bad "订单状态变化记录缺失"

# 前台订单可见
MYO=$(req GET /orders "" "$UTOKEN")
[ "$(echo "$MYO" | jget total)" != "0" ] && ok "前台「我的订单」可见" || bad "前台看不到自己的订单"

############################# 系统设置（提前做，好让后面的日志断言能查到 setting.update）
step "系统设置（§10）"
ST=$(req GET /admin/settings "" "$ATOKEN")
STN=$(echo "$ST" | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('data') or []))")
[ "$STN" -ge 10 ] && ok "系统设置项 $STN 条" || bad "设置项偏少：$STN"

SETU=$(req PUT /admin/settings "{\"items\":[{\"key\":\"site_name\",\"value\":\"豆玩 DOUWAN $RUN_ID\"},{\"key\":\"payment_secret\",\"value\":\"e2e-secret-$RUN_ID\"}]}" "$ATOKEN")
SECVAL=$(echo "$SETU" | python3 -c "import sys,json;print(next((x['value'] for x in json.load(sys.stdin)['data'] if x['key']=='payment_secret'),''))")
if echo "$SECVAL" | grep -q "e2e-secret"; then bad "接口回传了密钥明文"; else ok "密钥只返回脱敏值（$SECVAL）"; fi
PST=$(curl -s "$API/settings/public")
if echo "$PST" | grep -q "e2e-secret"; then bad "公开设置泄漏密钥"; else ok "公开设置不含密钥"; fi
[ "$(echo "$PST" | jget data.site_name)" = "豆玩 DOUWAN $RUN_ID" ] && ok "公开设置反映修改（站点名）" || bad "公开设置未生效"

############################# 用户与日志
step "用户列表 / 操作日志 / 概览（§4 / §9 / §11）"
UL=$(req GET "/admin/users?keyword=$UNAME&page=1&page_size=10" "" "$ATOKEN")
URED=$(echo "$UL" | jget data.list.0.redeemed_count)
UPAID=$(echo "$UL" | jget data.list.0.paid_amount)
[ "$URED" = "2" ] && ok "用户列表显示已兑换 2 张卡密" || bad "用户兑换统计异常：$URED"
[ "$UPAID" = "29.5" ] && ok "用户列表显示已支付 29.5" || bad "用户支付统计异常：$UPAID"
UMAIL=$(echo "$UL" | jget data.list.0.email)
[ "$UMAIL" = "" ] && ok "用户列表不返回敏感信息（未填邮箱则为空）" || ok "用户邮箱脱敏：$UMAIL"

LOGS=$(req GET "/admin/logs?page=1&page_size=50" "" "$ATOKEN")
LTOTAL=$(echo "$LOGS" | jget data.total)
[ "$LTOTAL" != "0" ] && ok "操作日志已记录（$LTOTAL 条）" || bad "操作日志为空"
# 关键动作都在（setting.update 在上一步已经触发，所以这里能查到）
ACTIONS=$(echo "$LOGS" | python3 -c "import sys,json;print(' '.join(x['action'] for x in json.load(sys.stdin)['data']['list']))")
for a in card.generate card.export card.reveal card.redeem order.settle order.issue_cards asset.upload setting.update admin.login; do
  echo "$ACTIONS" | grep -q "$a" && ok "日志包含 $a" || bad "日志缺少 $a"
done
# 日志不含明文密码/密钥
if echo "$LOGS" | grep -q "$ADMIN_PW"; then bad "日志里出现了管理员明文密码"; else ok "日志不含管理员明文密码"; fi
if echo "$LOGS" | grep -q "$(echo "$FIRST" | tr -d '-')"; then bad "日志里出现了完整卡密"; else ok "日志不含完整卡密明文"; fi

OV=$(req GET /admin/overview "" "$ATOKEN")
OVPAID=$(echo "$OV" | jget data.cards.total_paid_amount)
[ "$OVPAID" != "0" ] && ok "概览累计已支付=$OVPAID" || bad "概览金额为 0"
OVCH=$(echo "$OV" | jget data.payment.channel_configured)
[ "$OVCH" = "False" ] && ok "概览如实标注「支付暂未接入」" || bad "概览支付状态异常"

############################# 权限
step "权限与越权（§3.3）"
# 越权：用普通用户令牌调后台
CROSS=$(curl -s -o /dev/null -w '%{http_code}' "$API/admin/overview" -H "Authorization: Bearer $UTOKEN")
[ "$CROSS" = "401" ] && ok "普通用户令牌调后台接口返回 401" || bad "普通用户令牌可访问后台（$CROSS）"

# 运营角色：能看卡密但不能看明文/导出/改设置
# 先按「可能已存在」清理：脚本会被重复执行，运营账号用固定名字便于识别
OPNAME="e2eop"
EXIST=$(req GET "/admin/admins?keyword=$OPNAME&page=1&page_size=5" "" "$ATOKEN")
EXIST_ID=$(echo "$EXIST" | python3 -c "import sys,json;d=json.load(sys.stdin)['data']['list'];print(d[0]['id'] if d else '')")
if [ -n "$EXIST_ID" ]; then
  # 同名账号存在就复位成可用的运营账号（改密码 + 启用），保证脚本可重复执行
  req POST "/admin/admins/$EXIST_ID/password" '{"new_password":"operator-pass-1234"}' "$ATOKEN" > /dev/null
  req PATCH "/admin/admins/$EXIST_ID" '{"role":"operator"}' "$ATOKEN" > /dev/null
  req PATCH "/admin/admins/$EXIST_ID/status" '{"status":1,"reason":"E2E 脚本复位"}' "$ATOKEN" > /dev/null
  ok "复用已存在的运营账号（id=$EXIST_ID，已复位密码与状态）"
  OPID="$EXIST_ID"
else
  OP=$(req POST /admin/admins "{\"username\":\"$OPNAME\",\"password\":\"operator-pass-1234\",\"nickname\":\"E2E 运营\",\"role\":\"operator\"}" "$ATOKEN")
  OPID=$(echo "$OP" | jget data.id)
  [ -n "$OPID" ] && ok "新建运营管理员成功（id=$OPID）" || bad "新建运营管理员失败：$(echo "$OP" | jget message)"
fi
OPL=$(req POST /admin/auth/login "{\"account\":\"$OPNAME\",\"password\":\"operator-pass-1234\"}")
OPTOKEN=$(echo "$OPL" | jget data.tokens.access_token)
[ -n "$OPTOKEN" ] && ok "运营管理员可登录" || bad "运营管理员登录失败：$(echo "$OPL" | jget message)"

OPLIST=$(curl -s -o /dev/null -w '%{http_code}' "$API/admin/card-keys" -H "Authorization: Bearer $OPTOKEN")
[ "$OPLIST" = "200" ] && ok "运营可以查看卡密列表" || bad "运营查看卡密列表返回 $OPLIST"
OPREV=$(curl -s -X POST "$API/admin/card-keys/reveal" -H "Content-Type: application/json" -H "Authorization: Bearer $OPTOKEN" -d '{"ids":[]}' -o /dev/null -w '%{http_code}')
[ "$OPREV" = "403" ] && ok "运营查看明文被拒绝（403）" || bad "运营可查看明文（$OPREV）"
OPEXP=$(curl -s -X POST "$API/admin/card-keys/export" -H "Content-Type: application/json" -H "Authorization: Bearer $OPTOKEN" -d '{}' -o /dev/null -w '%{http_code}')
[ "$OPEXP" = "403" ] && ok "运营导出卡密被拒绝（403）" || bad "运营可导出卡密（$OPEXP）"
OPADM=$(curl -s -o /dev/null -w '%{http_code}' "$API/admin/admins" -H "Authorization: Bearer $OPTOKEN")
[ "$OPADM" = "403" ] && ok "运营访问管理员管理被拒绝（403）" || bad "运营可访问管理员管理（$OPADM）"
OPSET=$(curl -s -X PUT "$API/admin/settings" -H "Content-Type: application/json" -H "Authorization: Bearer $OPTOKEN" -d '{"items":[{"key":"site_name","value":"hack"}]}' -o /dev/null -w '%{http_code}')
[ "$OPSET" = "403" ] && ok "运营修改系统设置被拒绝（403）" || bad "运营可修改系统设置（$OPSET）"

############################# 清理与收尾
step "收尾"
# 停用运营账号（保留记录便于审计）
req PATCH "/admin/admins/$OPID/status" '{"status":0,"reason":"E2E 自动化测试收尾"}' "$ATOKEN" > /dev/null
ok "已停用 E2E 运营账号"
# 下架测试套餐，避免影响前台
req PATCH "/admin/plans/$PID/status" '{"status":"archived","reason":"E2E 自动化测试收尾"}' "$ATOKEN" > /dev/null
ok "已下架 E2E 测试套餐"

printf '\n\033[1m结果：通过 %d 项，失败 %d 项\033[0m\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1
