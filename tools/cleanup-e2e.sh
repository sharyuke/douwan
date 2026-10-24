#!/usr/bin/env bash
# 清理 E2E 测试留下的数据（在 qq 上以 root 运行）。
#
# 为什么需要它：线上自测会真的建套餐、发卡密、上传素材、注册用户，
# 跑完必须收拾干净，否则运营看到的是「一堆叫 E2E 测试套餐的东西」。
# 只删测试数据，不动 douwan 这个真实管理员账号与四个占位草稿套餐。
set -uo pipefail

PSQL() { sudo -u postgres psql -d douwan -tAc "$1"; }

# 测试数据的识别规则：这些前缀/名字都是自测脚本专用的
PLAN_MATCH="name like 'E2E%' or name like '%订单号验证%' or name like '%手动测试%' or name like '%PG 冒烟%' or name like '连单套餐' or name like '权限矩阵套餐' or name like '并发%套餐' or name like '订单号测试'"
USER_MATCH="username like 'e2e%' or username like 'ordertest%' or username like 'race%' or username like 'seqorder%' or username like 'matrix%' or username like 'issueuser%' or username like 'carol%' or username like 'alice%' or username like 'bob%' or username like 'dave%' or username like 'erin%' or username like 'frank%' or username like 'grace%' or username like 'normal%' or username like 'pguser%' or username like 'actverify%'"
ASSET_MATCH="title like 'E2E%' or title like '%手动测试%' or title like '同名%' or title in ('调试素材','调试素材2','假图片','svg','cake','猫') or slug like 'e2e%' or slug like 'manual-%'"

echo "=== 清理前 ==="
for t in plans library_assets library_categories users admins card_keys orders entitlements user_daily_activities user_feature_daily; do
  printf '%-24s %s\n' "$t" "$(PSQL "select count(*) from $t")"
done

echo
echo "=== 1) 测试素材与分类 ==="
PSQL "delete from library_assets where $ASSET_MATCH" | sed 's/^/  删除素材: /'
PSQL "delete from library_categories where name like 'E2E%' or name like '%手动测试%' or name like '%同名上传%' or name like 'PG %' or slug like 'e2e%' or slug like 'manual-%'" | sed 's/^/  删除分类: /'

echo "=== 2) 测试套餐的卡密 / 订单 / 权益 / 套餐 ==="
PSQL "delete from card_keys where plan_id in (select id from plans where $PLAN_MATCH)" | sed 's/^/  删除卡密: /'
PSQL "delete from entitlements where plan_id in (select id from plans where $PLAN_MATCH)" | sed 's/^/  删除权益(按套餐): /'
PSQL "delete from order_events where order_id in (select id from orders where plan_id in (select id from plans where $PLAN_MATCH))" | sed 's/^/  删除订单事件: /'
PSQL "delete from orders where plan_id in (select id from plans where $PLAN_MATCH)" | sed 's/^/  删除订单: /'
PSQL "delete from plans where $PLAN_MATCH" | sed 's/^/  删除套餐: /'

echo "=== 3) 测试用户及其关联数据 ==="
UIDS="(select id from users where $USER_MATCH)"
PSQL "delete from entitlements where user_id in $UIDS" | sed 's/^/  删除权益: /'
PSQL "delete from card_keys where redeemed_by in $UIDS" | sed 's/^/  解除卡密兑换人: /'
PSQL "delete from order_events where order_id in (select id from orders where user_id in $UIDS)" | sed 's/^/  删除订单事件: /'
PSQL "delete from orders where user_id in $UIDS" | sed 's/^/  删除订单: /'
PSQL "delete from credit_transactions where user_id in $UIDS" | sed 's/^/  删除 Credits 流水: /'
PSQL "delete from credit_accounts where user_id in $UIDS" | sed 's/^/  删除 Credits 账户: /'
PSQL "delete from usage_stats where user_id in $UIDS" | sed 's/^/  删除使用统计: /'
PSQL "delete from memberships where user_id in $UIDS" | sed 's/^/  删除会员: /'
# 用户活跃数据（用户日汇总 + 功能使用日汇总）也要一起删：
# 只删用户不删活跃记录的话，测试账号会永远留在日活/渠道/功能统计里
PSQL "delete from user_daily_activities where user_id in $UIDS" | sed 's/^/  删除活跃日汇总: /'
PSQL "delete from user_feature_daily where user_id in $UIDS" | sed 's/^/  删除功能日汇总: /'
PSQL "delete from users where id in $UIDS" | sed 's/^/  删除用户: /'

echo "=== 4) 测试管理员（保留 douwan） ==="
PSQL "delete from operation_logs where admin_id in (select id from admins where username <> 'douwan')" | sed 's/^/  删除测试管理员日志: /'
PSQL "delete from admins where username <> 'douwan' and (username like 'e2e%' or username like 'actverify%' or username like 'actcheck%' or username in ('secondadmin','opuser','probe'))" | sed 's/^/  删除管理员: /'

echo "=== 4.5) 兜底：清掉已经没有对应用户的活跃记录 ==="
# 用户被别的路径删掉（或手工 psql 删过）时会留下孤儿行，
# 它们会永远算进日活/地区/功能统计里，这里统一扫掉。
PSQL "delete from user_daily_activities where user_id not in (select id from users)" | sed 's/^/  孤儿日汇总: /'
PSQL "delete from user_feature_daily where user_id not in (select id from users)" | sed 's/^/  孤儿功能汇总: /'

echo "=== 5) 清理测试上传的磁盘文件 ==="
# 只删 2 小时内新增的文件（就是自测产生的），保留其它
find /var/lib/douwan/uploads -type f -newermt '-2 hours' -delete 2>/dev/null
# 只删空的**子目录**，绝不删 uploads 根目录本身：
# systemd 单元里有 ReadWritePaths=/var/lib/douwan/uploads，
# 目录不存在时服务会以 226/NAMESPACE 启动失败（这是踩过的坑）。
find /var/lib/douwan/uploads -mindepth 1 -type d -empty -delete 2>/dev/null
install -d -m 755 -o douwan -g douwan /var/lib/douwan/uploads
echo "  剩余文件数: $(find /var/lib/douwan/uploads -type f | wc -l)"

echo
echo "=== 清理后 ==="
for t in users plans card_keys orders entitlements library_assets library_categories admins operation_logs settings user_daily_activities user_feature_daily; do
  printf '%-24s %s\n' "$t" "$(PSQL "select count(*) from $t")"
done
echo
echo "--- 剩余套餐（应只有 4 个占位草稿） ---"
PSQL "select id || ' | ' || code || ' | ' || name || ' | ' || status from plans order by id"
echo "--- 剩余管理员（应只有 douwan） ---"
PSQL "select id || ' | ' || username || ' | ' || role || ' | ' || status from admins order by id"
