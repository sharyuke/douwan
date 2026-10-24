<script setup>
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import BaseDialog from '../components/ui/BaseDialog.vue'
import CardRedeemPanel from '../components/ui/CardRedeemPanel.vue'
import {
  ensureBackend, serverPlans, backendReady, createOrder, siteSettings
} from '../composables/useBackend.js'
import { isLoggedIn, bootstrapUser } from '../composables/useUserAccount.js'
import { applyServerMembership, applyServerPermissions } from '../composables/useMembership.js'
import { api, ApiError } from '../lib/api.js'
import {
  PLANS, isPro, planLabel, plan, credits, creditsBalance, usage,
  upgradeTo, setYearly, cancelPlan, addCredits, CREDIT_COST, ENTITLEMENTS, check
} from '../composables/useMembership.js'
import { toastOk, toastWarn, toastErr } from '../composables/useToast.js'

const router = useRouter()
const billing = ref('month')
const payOpen = ref(false)
const selected = ref(null)
const customize = ref(false)
const brandName = ref('')
const authorName = ref('')

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

const pro = computed(() => PLANS.find(p => p.id === 'pro'))
const free = computed(() => PLANS.find(p => p.id === 'free'))

const matrix = [
  { feature: '基础图片生成', guest: '✓', free: '✓', pro: '✓', key: 'generate.basic' },
  { feature: '基础编辑（画笔 / 橡皮 / 撤销）', guest: '✓', free: '✓', pro: '✓', key: null },
  { feature: '免费素材库', guest: '✓', free: '✓', pro: '✓', key: null },
  { feature: '三方案自动搜索 + AI 推荐', guest: '×', free: '1 个方案', pro: '3 个方案', key: 'generate.variants' },
  { feature: '抠图去背景 · 只留主体（背景与投影一起去掉 · 三档力度）', guest: '×', free: '✓', pro: '✓', key: null },
  { feature: '卡通化 · 照片先转卡通形象再出图（三档风格 · 只概括不编造）', guest: '×', free: '✓', pro: '✓', key: null },
  { feature: '最大画布（复杂照片的精细档）', guest: '×', free: '52 × 52 格（一块 52 钉板）', pro: '按 52 / 78 / 104 钉板一块一块加，单边最大 1000 格', key: 'canvas.cells' },
  { feature: '可拼性优化（去孤立豆 / 抖动）', guest: '×', free: '×', pro: '✓', key: 'optimize.buildability' },
  { feature: '品牌色板', guest: '×', free: '漫德全色号（221 色）', pro: '全部品牌（613 色）', key: 'palette.full' },
  { feature: '库存约束配色', guest: '×', free: '×', pro: '✓', key: 'inventory.use' },
  { feature: 'PNG 图纸导出', guest: '✓', free: '✓', pro: '✓', key: 'export.png' },
  { feature: 'PDF 分板图纸 / 1:1 打印', guest: '×', free: '×', pro: '✓', key: 'export.pdf' },
  { feature: '材料清单 CSV', guest: '×', free: '×', pro: '✓', key: 'export.csv' },
  { feature: 'SVG 矢量导出', guest: '×', free: '×', pro: '✓', key: 'export.svg' },
  { feature: '分享卡导出', guest: '×', free: '×', pro: '✓', key: 'export.share' },
  { feature: '标记作品完成 · 成长记录', guest: '×', free: '✓', pro: '✓', key: null },
  { feature: 'Build Mode 逐颗 / 整板拼制进度', guest: '×', free: '×', pro: '✓', key: 'build.mode' },
  { feature: '本机作品存档', guest: '×', free: '3 件', pro: '40 件', key: 'projects.limit' },
  { feature: '会员专属素材', guest: '×', free: '×', pro: '✓', key: 'assets.pro' },
  { feature: '批量生成 / 导出', guest: '×', free: '×', pro: '×', key: 'batch.export' },
  { feature: '商用授权', guest: '×', free: '×', pro: '×', key: 'license.commercial' }
]

const aiPacks = [
  { credits: 50, price: 9.9, tag: '' },
  { credits: 200, price: 29.9, tag: '最划算' },
  { credits: 600, price: 79.9, tag: '' }
]

const creditCosts = [
  { name: 'AI 文字生成图案', cost: CREDIT_COST['ai.text'] },
  { name: '三方案深度搜索', cost: CREDIT_COST['ai.variants'] },
  { name: '批量生成（每 10 张）', cost: CREDIT_COST['ai.batch'] }
]

function openPay(planId) {
  selected.value = planId
  payOpen.value = true
}

function confirmPay() {
  if (selected.value === 'pro') {
    if (billing.value === 'year') setYearly()
    else upgradeTo(1)
    toastOk(billing.value === 'year' ? '已开通 Pro 年付（演示环境，未真实扣款）' : '已开通 Pro 月付（演示环境，未真实扣款）')
  } else {
    cancelPlan()
    toastOk('已退回免费版')
  }
  payOpen.value = false
}

function buyCredits(pack) {
  addCredits(pack.credits, `购买 ${pack.credits} credits`)
  toastOk(`已到账 ${pack.credits} credits（演示环境，未真实扣款）`)
}

const faqs = [
  {
    q: '免费版能做出完整的作品吗？',
    a: '能。基础图片转换、基础编辑、免费素材库、PNG 导出和 3 件作品存档都是免费的，而且不限次数。市面上基础转换已经免费，我们不会把这一层做成收费墙 —— Pro 卖的是「真的能拼完」需要的能力。'
  },
  {
    q: 'Pro 到底多了什么？',
    a: '三方案自动搜索与可拼性优化（让图案更好拼）、大画布（档位 52 → 312 共 6 档，更大的走「自定义尺寸」按 52 / 78 / 104 钉板一块一块加，单边最大 1000 格，复杂照片和真人照能转出五官与衣纹）、库存约束配色（只用你手里的豆）、分板 PDF 与 1:1 打印图纸、材料清单 CSV、逐颗 / 整板拼制进度、分享卡。这些是完成一件大作品真正会用到的。（「标记作品完成 · 成长记录」免费版也有 —— 记录自己拼完了什么，不该拿来收费。）'
  },
  {
    q: 'AI Credits 怎么算？',
    a: '基础图片转拼豆完全不用 Credits，因为它在你的浏览器本地完成。自动抠图与卡通化滤镜同样免费 —— 它们也是浏览器内的算法。只有调用服务端 AI 的功能（文字生图、AI 抠图、AI 卡通化、深度方案搜索、批量生成）才按 Credits 计费，订阅会包含基础额度，可以单独加购。'
  },
  {
    q: '我的照片会被上传吗？',
    a: '默认不会。图片解码、缩放、调色、生成图纸全部在你的浏览器里完成。只有你主动点击「AI 生成」类按钮时，这张图才会被上传到豆玩自建的推理节点（不经过第三方模型服务）用于生成结果，输入图 24 小时后自动清理。不带 AI 的常规转换任何时候都不会上传。'
  },
  {
    q: '色号和真实豆子对得上吗？',
    a: '色板数据来自公开整理的第三方色卡，MARD 221 做了两份独立来源的逐色交叉验证。但第三方数据无法保证永久准确，采购前请以实体色卡为准。同色号在不同品牌之间不能通用。'
  },
  {
    q: '可以商用吗？',
    a: '平台自制素材可免费使用在个人作品中。批量生成、店铺信息自定义与正式商用授权属于 Creator 套餐，目前尚未开放 —— 我们不会先收钱再补功能。'
  }
]

function cellClass(v) {
  if (v === '✓') return 'yes'
  if (v === '×') return 'no'
  return 'part'
}
</script>

<template>
  <div class="wrap main--pad">

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
      <div v-if="!serverMode" class="planGrid">
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

    <div class="pagehead" style="flex-direction:column;align-items:center;text-align:center">
      <div>
        <span class="badge">会员与定价</span>
        <h1 style="margin-top:12px">基础转换一直免费</h1>
        <p style="max-width:640px;margin:10px auto 0">
          Pro 解锁的不是「能不能生成」，而是「能不能真的拼完」：
          三方案的自动搜索、可拼性优化、库存约束配色、分板 PDF、拼制进度。
        </p>
      </div>
    </div>

    <div class="billingSwitch">
      <button :class="{ on: billing === 'month' }" @click="billing = 'month'">按月</button>
      <button :class="{ on: billing === 'year' }" @click="billing = 'year'">按年 <span class="saveTag">省 33%</span></button>
    </div>

    <div v-if="isPro" class="currentBar">
      <span>👑 你当前是 <b>{{ planLabel }}</b><template v-if="plan.expireAt">，有效期至 {{ new Date(plan.expireAt).toLocaleDateString() }}</template></span>
      <div class="row">
        <RouterLink to="/account" class="btn sm">我的账户</RouterLink>
        <button class="btn sm danger" @click="confirmPay(); selected = 'free'">退订（演示）</button>
      </div>
    </div>

    <!-- 套餐 -->
    <div class="planGrid">
      <div class="plan">
        <div>
          <h3>{{ free.name }}</h3>
          <p class="muted" style="margin-top:4px">{{ free.tagline }}</p>
        </div>
        <div class="plan__price"><b>¥0</b><span>永久免费</span></div>
        <ul>
          <li v-for="f in free.features" :key="f.text" :class="{ off: !f.on }">
            <i>{{ f.on ? '✓' : '×' }}</i>{{ f.text }}
          </li>
        </ul>
        <RouterLink v-if="!isPro" to="/editor" class="btn block">当前套餐 · 去创作</RouterLink>
        <button v-else class="btn block" @click="selected = 'free'; openPay('free')">降级到免费版</button>
      </div>

      <div class="plan featured">
        <span class="plan__ribbon badge">最受欢迎</span>
        <div>
          <h3>{{ pro.name }} <span class="tag pro">PRO</span></h3>
          <p class="muted" style="margin-top:4px">{{ pro.tagline }}</p>
        </div>
        <div class="plan__price">
          <b>¥{{ billing === 'year' ? pro.yearPrice : pro.price }}</b>
          <span>{{ billing === 'year' ? '/ 年' : '/ 月' }}</span>
        </div>
        <ul>
          <li v-for="f in pro.features" :key="f.text" :class="{ off: !f.on }">
            <i>{{ f.on ? '✓' : '×' }}</i>{{ f.text }}
          </li>
        </ul>
        <button v-if="!isPro" class="btn primary block lg" @click="openPay('pro')">
          {{ billing === 'year' ? `升级 Pro 年付 ¥${pro.yearPrice}` : `升级 Pro ¥${pro.price}/月` }}
        </button>
        <RouterLink v-else to="/account" class="btn block lg">管理我的会员</RouterLink>
        <p class="hint" style="text-align:center">7 天内不满意可以退，写邮件说明即可</p>
      </div>

      <div class="plan">
        <div>
          <h3>Creator <span class="tag">即将开放</span></h3>
          <p class="muted" style="margin-top:4px">给设计师与工作室</p>
        </div>
        <div class="plan__price"><b>¥39.9</b><span>/ 月</span></div>
        <ul>
          <li><i>·</i>批量生成与批量导出</li>
          <li><i>·</i>正式商用授权</li>
          <li><i>·</i>自定义店铺名 / Logo / 作者名</li>
          <li><i>·</i>500+ 云端项目</li>
          <li><i>·</i>高级 AI 模型</li>
          <li><i>·</i>优先体验新功能</li>
        </ul>
        <button class="btn block" @click="toastWarn('Creator 套餐还在开发中。我们不会先收钱再补功能。')">
          订阅通知我
        </button>
      </div>
    </div>

    <!-- Credits -->
    <section class="secHead">
      <div>
        <h2>AI Credits</h2>
        <p>基础图片转拼豆不需要 Credits —— 它在你的浏览器本地完成。只有调用服务端模型的功能才计费。</p>
      </div>
    </section>
    <div class="creditGrid">
      <div v-for="p in aiPacks" :key="p.credits" class="creditCard">
        <span v-if="p.tag" class="tag new">{{ p.tag }}</span>
        <b class="creditNum">{{ p.credits }}</b>
        <span class="muted">credits</span>
        <b class="creditPrice">¥{{ p.price }}</b>
        <button class="btn block" @click="buyCredits(p)">加购</button>
      </div>
    </div>
    <div class="creditBox" style="margin-top:14px">
      <div>
        <b>当前余额：{{ creditsBalance }} credits</b>
        <p class="hint" style="margin-top:4px">
          <template v-if="credits.log && credits.log.length">
            最近一次：{{ credits.log[0].note || '消费' }} {{ credits.log[0].cost > 0 ? '-' + credits.log[0].cost : '+' + (-credits.log[0].cost) }}
          </template>
          <template v-else>还没有使用记录</template>
        </p>
      </div>
      <div class="row row--wrap">
        <span v-for="c in creditCosts" :key="c.name" class="tag">{{ c.name }} · {{ c.cost }}</span>
      </div>
    </div>

    <!-- 权限矩阵 -->
    <section class="secHead">
      <div>
        <h2>完整权限对比</h2>
        <p>按钮不会凭空消失 —— 权限不够时会明确告诉你原因并给出升级入口</p>
      </div>
    </section>
    <div class="tableWrap">
      <table class="table">
        <thead>
          <tr>
            <th>功能</th>
            <th class="num">游客</th>
            <th class="num">免费版</th>
            <th class="num">Pro</th>
            <th>当前状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in matrix" :key="r.feature">
            <td>{{ r.feature }}</td>
            <td class="num" :class="cellClass(r.guest)">{{ r.guest }}</td>
            <td class="num" :class="cellClass(r.free)">{{ r.free }}</td>
            <td class="num" :class="cellClass(r.pro)">{{ r.pro }}</td>
            <td>
              <span v-if="r.key" class="tag" :class="check(r.key).ok ? 'free' : 'warn'">
                {{ check(r.key).ok ? '可用' : '未解锁' }}
              </span>
              <span v-else class="tag free">可用</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- FAQ -->
    <section class="secHead">
      <div><h2>常见问题</h2><p>写清楚比说漂亮更重要</p></div>
    </section>
    <div class="faq">
      <details v-for="(f, i) in faqs" :key="f.q" :open="i === 0">
        <summary>{{ f.q }}</summary>
        <p>{{ f.a }}</p>
      </details>
    </div>

    <p class="hint" style="margin-top:24px;text-align:center">
      本页价格是内部测试口径（PRD §24 建议），会按真实数据持续调整。
      当前环境为前端演示：点击开通不会真实扣款，只切换本地权限状态，方便你验证各套餐下的功能差异。
    </p>


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

    <!-- 支付弹窗 -->
    <BaseDialog v-model="payOpen" :title="selected === 'pro' ? '开通 Pro' : '切换套餐'" size="sm">
      <div v-if="selected === 'pro'" class="stack stack--sm">
        <div class="payRow">
          <span>Pro {{ billing === 'year' ? '年付' : '月付' }}</span>
          <b>¥{{ billing === 'year' ? pro.yearPrice : pro.price }}</b>
        </div>
        <div class="boardInfo">
          {{ billing === 'year' ? `折合 ¥${(pro.yearPrice / 12).toFixed(1)} / 月，比月付省 33%` : `年付 ¥${pro.yearPrice}，折合 ¥${(pro.yearPrice / 12).toFixed(1)} / 月` }}
        </div>
        <label class="check">
          <input v-model="customize" type="checkbox">
          我还会用到店铺信息与批量导出（Creator 功能，暂未开放）
        </label>
        <div v-if="customize" class="grid-2">
          <input v-model="brandName" type="text" placeholder="店铺 / 品牌名">
          <input v-model="authorName" type="text" placeholder="作者名">
        </div>
        <p class="hint">
          这是演示环境，不会真实扣款，只会在本机记录套餐状态，方便你立刻验证 Pro 功能。
        </p>
      </div>
      <div v-else class="stack stack--sm">
        <p style="font-size:var(--fs-sm);line-height:1.8;color:var(--ink-2)">
          降级到免费版后：三方案搜索会变成 1 个方案，PDF / CSV / 库存约束 / 逐颗拼制进度会变为不可用；
          已保存的作品与完成记录不会被删除，「完成作品」也照常可用，但超过 3 件的部分需要重新升级才能继续保存。
        </p>
      </div>
      <template #footer="{ close }">
        <button class="btn" @click="close">取消</button>
        <button class="btn primary" @click="confirmPay">
          {{ selected === 'pro' ? '确认开通（演示）' : '确认降级（演示）' }}
        </button>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
.pagehead{align-items:center}
.billingSwitch{
  display:inline-flex;gap:4px;padding:4px;background:var(--surface-3);border-radius:var(--r-pill);
  margin:0 auto 22px;width:max-content;
}
.billingSwitch button{padding:9px 20px;border-radius:var(--r-pill);font-size:var(--fs-sm);font-weight:750;color:var(--muted);transition:var(--t)}
.billingSwitch button.on{background:var(--surface);color:var(--ink);box-shadow:var(--sh-1)}
.saveTag{font-size:10px;background:var(--coral);color:#fff;padding:1px 6px;border-radius:var(--r-pill);margin-left:4px}
.currentBar{
  display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;
  padding:13px 17px;border-radius:var(--r-md);background:var(--yellow-soft);border:1px solid #F0E3A8;
  margin-bottom:20px;font-size:var(--fs-xs);
}
.creditGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
.creditCard{
  position:relative;padding:20px;border-radius:var(--r-lg);background:var(--surface);
  border:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;
}
.creditNum{font-size:30px;font-weight:900;letter-spacing:-.03em;color:var(--coral-deep)}
.creditPrice{font-size:17px;margin:6px 0 10px}
.tableWrap td.yes{color:var(--green);font-weight:800}
.tableWrap td.no{color:var(--muted-2)}
.tableWrap td.part{color:var(--orange-deep);font-weight:750;font-size:var(--fs-2xs)}
.payRow{display:flex;justify-content:space-between;align-items:baseline;font-size:var(--fs-sm);font-weight:750}
.payRow b{font-size:26px;letter-spacing:-.03em;color:var(--coral-deep)}
.boardInfo{padding:11px;border-radius:var(--r-sm);background:var(--surface-2);border:1px solid var(--line);font-size:var(--fs-2xs);color:var(--muted);line-height:1.7}
@media(max-width:900px){.creditGrid{grid-template-columns:1fr}}
</style>
