#!/usr/bin/env python3
"""把「前台接入服务端」的改动重新应用到较新的 master 版本上。

同样只做外科式增量：不清空远程新写的界面内容，只插入
「卡密兑换入口 / 服务端套餐 / 我的订单」这三块。

幂等：有标记就不重复插入。
"""
import pathlib

ROOT = pathlib.Path.home() / 'Documents/work/dw/pindoudou'


def patch(path: str, edits: list[tuple[str, str]]) -> None:
    p = ROOT / path
    src = p.read_text(encoding='utf-8')
    changed = False
    for old, new in edits:
        if old not in src:
            print(f'!! {path}: 找不到锚点 {old[:50]!r}')
            continue
        src = src.replace(old, new, 1)
        changed = True
    if changed:
        p.write_text(src, encoding='utf-8')
        print(f'✓ {path}')
    else:
        print(f'· {path}（无需改动）')


# ================================================================ PricingView
PRICING_IMPORTS = """import BaseDialog from '../components/ui/BaseDialog.vue'
import CardRedeemPanel from '../components/ui/CardRedeemPanel.vue'
import {
  ensureBackend, serverPlans, backendReady, createOrder, siteSettings
} from '../composables/useBackend.js'
import { isLoggedIn, bootstrapUser } from '../composables/useUserAccount.js'
import { applyServerMembership, applyServerPermissions } from '../composables/useMembership.js'
import { api, ApiError } from '../lib/api.js'"""

PRICING_BODY = '''
/* ------------------------------------------------------------------ 服务端套餐与卡密兑换
   需求 §1.2 第 9 条：前台要能展示已上架套餐、下单、输入卡密兑换。
   服务端不可用时自动回落成原来的本地演示口径，不白屏、不影响免费功能。 */
const tab = ref('plans')

/** 服务端是否返回了已上架套餐 */
const serverMode = computed(() => backendReady.value && serverPlans.value.length > 0)

/** 支付状态说明：来自后台「系统设置」，未接入渠道时必须如实告诉用户 */
const paymentNotice = computed(() => (siteSettings.value && siteSettings.value.payment_notice) || '')

/** 服务端套餐的前台展示形状（字段全部来自后台配置，前台不写死任何价格） */
const serverPlanCards = computed(() => serverPlans.value.map(p => ({
  id: p.id,
  code: p.code,
  name: p.name,
  tagline: p.tagline || p.short_desc,
  price: p.price,
  originalPrice: p.original_price,
  validityText: p.validity_text,
  tag: p.tag,
  features: (p.feature_text && p.feature_text.length) ? p.feature_text : [],
  usageLimit: p.usage_limit
})))

const buying = ref(false)
const orderOpen = ref(false)
const pendingOrder = ref(null)

onMounted(async () => {
  await bootstrapUser()
  await ensureBackend()
  if (isLoggedIn.value) await syncFromServer()
})

/** 登录状态下把服务端权益与额度同步到前台判定，否则按钮口径会不一致 */
async function syncFromServer() {
  try {
    const [me, perms] = await Promise.all([
      api.get('/users/me'),
      api.get('/permissions', { auth: true }).catch(() => null)
    ])
    applyServerMembership(me.membership)
    if (me.credits) credits.value = { ...credits.value, balance: me.credits.balance }
    if (perms && perms.permissions) applyServerPermissions(perms.permissions)
  } catch {
    /* 同步失败不影响浏览 */
  }
}

/**
 * 购买服务端套餐：登录 → 下单 → 提示等待人工确认收款。
 * 未接入支付渠道时不能假装支付成功，所以这里只创建订单并说清下一步。
 */
async function buyServerPlan(card) {
  if (!isLoggedIn.value) {
    tab.value = 'redeem'
    toastWarn('请先登录后再下单：订单与卡密需要绑定到账号')
    return
  }
  buying.value = true
  try {
    pendingOrder.value = await createOrder(card.id, 1)
    payOpen.value = false
    orderOpen.value = true
    toastOk(`已创建订单 ${pendingOrder.value.order_no}`)
  } catch (e) {
    toastErr(e instanceof ApiError ? e.message : '下单失败，请稍后重试')
  } finally {
    buying.value = false
  }
}
'''

PRICING_TEMPLATE = '''
    <!-- 页面主标签：套餐 / 卡密兑换（需求 §1.2 第 9 条：前台要能输入卡密兑换） -->
    <div class="billingSwitch" style="margin-top:-6px">
      <button :class="{ on: tab === 'plans' }" @click="tab = 'plans'">套餐</button>
      <button :class="{ on: tab === 'redeem' }" @click="tab = 'redeem'">卡密兑换</button>
    </div>

    <section v-show="tab === 'redeem'" style="max-width:560px;margin:0 auto 26px">
      <div class="creditBox" style="display:block">
        <h2 style="font-size:var(--fs-h2);margin-bottom:8px">输入卡密，立即开通</h2>
        <p class="hint" style="margin-bottom:14px">
          如果你是从线下渠道、客服或活动拿到的卡密，在这里兑换就能开通对应权益。
          兑换成功后权益绑定到你的账号，换设备登录也能继续使用。
        </p>
        <CardRedeemPanel />
        <p v-if="siteSettings && siteSettings.card_redeem_notice" class="hint" style="margin-top:12px">
          {{ siteSettings.card_redeem_notice }}
        </p>
      </div>
    </section>

    <!-- 服务端上架的套餐：价格与权益全部来自后台配置 -->
    <template v-if="tab === 'plans' && serverMode">
      <div v-if="paymentNotice" class="boardInfo" style="margin-bottom:18px;text-align:center">
        {{ paymentNotice }}
      </div>
      <div class="planGrid">
        <div v-for="p in serverPlanCards" :key="p.code" class="plan">
          <span v-if="p.tag" class="plan__ribbon badge">{{ p.tag }}</span>
          <div>
            <h3>{{ p.name }}</h3>
            <p class="muted" style="margin-top:4px">{{ p.tagline }}</p>
          </div>
          <div class="plan__price">
            <b>¥{{ p.price }}</b>
            <span>{{ p.validityText && p.validityText !== '不限时长' ? p.validityText : '永久' }}</span>
          </div>
          <p v-if="p.originalPrice" class="muted" style="text-decoration:line-through">原价 ¥{{ p.originalPrice }}</p>
          <ul>
            <li v-for="(t, i) in p.features" :key="i"><i>✓</i>{{ t }}</li>
            <li v-if="p.usageLimit"><i>✓</i>包含 {{ p.usageLimit }} 次额度</li>
          </ul>
          <button class="btn primary block lg" :disabled="buying" @click="buyServerPlan(p)">
            {{ isLoggedIn ? '购买 ¥' + p.price : '登录后购买' }}
          </button>
        </div>
      </div>
      <p class="hint" style="text-align:center">
        未接入在线支付时，下单后会生成订单并等待人工确认收款，确认后卡密会发放到你的订单里。
      </p>
    </template>
'''

PRICING_ORDER_DIALOG = '''
    <!-- 下单结果：未接入支付时必须如实告诉用户下一步 -->
    <BaseDialog v-model="orderOpen" title="订单已创建" size="sm">
      <div v-if="pendingOrder" class="stack stack--sm">
        <div class="payRow">
          <span>{{ pendingOrder.plan_name }}</span>
          <b>¥{{ pendingOrder.amount_due }}</b>
        </div>
        <div class="boardInfo">订单号 {{ pendingOrder.order_no }}</div>
        <p class="hint">
          {{ paymentNotice || '支付渠道尚未配置。请联系客服完成付款，管理员确认到账后会把卡密发放到你的订单里。' }}
          你可以在「我的账户」里随时查看订单状态与卡密。
        </p>
      </div>
      <template #footer="{ close }">
        <button class="btn" @click="close">知道了</button>
        <RouterLink to="/account" class="btn primary" @click="close">查看我的订单</RouterLink>
      </template>
    </BaseDialog>
'''

patch('src/views/PricingView.vue', [
    ("import { computed, ref } from 'vue'", "import { computed, onMounted, ref } from 'vue'"),
    ("import BaseDialog from '../components/ui/BaseDialog.vue'", PRICING_IMPORTS),
    ("import { toastOk, toastWarn } from '../composables/useToast.js'",
     "import { toastOk, toastWarn, toastErr } from '../composables/useToast.js'"),
    ("const pro = computed(() => PLANS.find(p => p.id === 'pro'))",
     PRICING_BODY.strip() + "\n\nconst pro = computed(() => PLANS.find(p => p.id === 'pro'))"),
    ("  <div class=\"wrap main--pad\">", "  <div class=\"wrap main--pad\">\n" + PRICING_TEMPLATE),
    # 本地演示套餐在服务端有数据时不再展示，避免同页出现两套价格
    ("    <div class=\"planGrid\">", "    <div v-if=\"!serverMode\" class=\"planGrid\">"),
    ("    <!-- 支付弹窗 -->", PRICING_ORDER_DIALOG + "\n    <!-- 支付弹窗 -->"),
])

# ================================================================ AccountView
ACCOUNT_IMPORTS = """import BaseDialog from '../components/ui/BaseDialog.vue'
import CardRedeemPanel from '../components/ui/CardRedeemPanel.vue'
import { isLoggedIn, bootstrapUser } from '../composables/useUserAccount.js'
import { myOrders, loadMyOrders, ensureBackend } from '../composables/useBackend.js'"""

ACCOUNT_BODY = '''
/* ------------------------------------------------------------------ 账号与订单
   服务端权益（卡密兑换 / 订单发卡）在这里落地：登录后能兑换卡密、看订单与已开通权益。 */
onMounted(async () => {
  await bootstrapUser()
  ensureBackend()
  await refreshOrders()
})

async function refreshOrders() {
  await loadMyOrders()
}
'''

ACCOUNT_TEMPLATE = '''
    <!-- 账号与卡密兑换 + 我的订单 -->
    <section class="accountBox">
      <div class="accountBox__col">
        <h2 class="accountBox__title">账号与卡密兑换</h2>
        <CardRedeemPanel />
      </div>
      <div class="accountBox__col">
        <h2 class="accountBox__title">我的订单</h2>
        <template v-if="isLoggedIn">
          <div v-if="myOrders.length" class="orderList">
            <div v-for="o in myOrders" :key="o.id" class="orderRow">
              <div>
                <b>{{ o.plan_name }}</b>
                <div class="muted orderRow__no">{{ o.order_no }}</div>
              </div>
              <div class="orderRow__right">
                <span class="tag" :class="o.payment_status === 'paid' ? 'free' : 'warn'">{{ o.payment_status_text }}</span>
                <span class="muted">¥{{ Number(o.amount_due).toFixed(2) }}</span>
                <span class="tag" :class="o.fulfillment_status === 'issued' ? 'free' : ''">{{ o.fulfillment_status_text }}</span>
              </div>
            </div>
          </div>
          <div v-else class="empty" style="padding:22px 10px">
            <strong>还没有订单</strong>
            <p>在「会员与定价」里下单后，未接入在线支付时需要管理员确认到账才会发放卡密。</p>
          </div>
          <button class="btn sm" @click="refreshOrders">刷新订单</button>
        </template>
        <div v-else class="empty" style="padding:22px 10px">
          <strong>登录后可以查看订单</strong>
          <p>订单与卡密都绑定在账号上，换设备登录也能看到。</p>
        </div>
      </div>
    </section>
'''

ACCOUNT_STYLE = '''<style scoped>
.accountBox{
  display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-bottom:22px;
}
.accountBox__col{
  padding:20px;border-radius:var(--r-lg);background:var(--surface);border:1px solid var(--line);
  box-shadow:var(--sh-1);display:flex;flex-direction:column;gap:12px;
}
.accountBox__title{font-size:var(--fs-h3)}
.orderList{display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto}
.orderRow{
  display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
  padding:10px 12px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line);
  font-size:var(--fs-xs);
}
.orderRow__no{font-size:var(--fs-2xs);font-family:ui-monospace,Menlo,Consolas,monospace;margin-top:2px}
.orderRow__right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
@media(max-width:900px){.accountBox{grid-template-columns:1fr}}
'''

av = ROOT / 'src/views/AccountView.vue'
src = av.read_text(encoding='utf-8')
if 'accountBox' in src:
    print('· src/views/AccountView.vue（已打过）')
else:
    src = src.replace("import { computed, ref } from 'vue'", "import { computed, onMounted, ref } from 'vue'", 1)
    src = src.replace("import BaseDialog from '../components/ui/BaseDialog.vue'", ACCOUNT_IMPORTS, 1)
    src = src.replace("const router = useRouter()", ACCOUNT_BODY.strip() + "\n\nconst router = useRouter()", 1)
    # 插到第一个 section 之前（页头之后）
    src = src.replace('    <!-- 会员卡 -->', ACCOUNT_TEMPLATE + '\n    <!-- 会员卡 -->', 1)
    src = src.replace('<style scoped>', ACCOUNT_STYLE, 1)
    av.write_text(src, encoding='utf-8')
    print('✓ src/views/AccountView.vue')

print('\n全部补丁完成')
