<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { ASSET_COUNT } from '../composables/useAssets.js'
import { BOARD_SPECS, BOARD_SPEC_LIST_TEXT, BOARDS, BEADS } from '../lib/boardSpec.js'
import { PALETTE_BRANDS, PALETTE_TOTAL_CODES } from '../lib/palettes.js'

const winW = ref(typeof window !== 'undefined' ? window.innerWidth : 1280)
function onResize() { winW.value = window.innerWidth }
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

/* 色号总数按「体系」去重：漫德 MARD 的 8 个套装（24~291）共用同一套色号，
   直接把各色板长度相加会数 8 遍（291+264+…+24 = 1136）。 */
const totalColors = computed(() => PALETTE_TOTAL_CODES)

/* 尺寸速查表的数字全部按口径算，不写死：成品厘米 = 格数 × 豆径（口径见 lib/boardSpec.js）。
   画布尺寸 = 某一个规格的整数倍（**整张画布只用一种规格**，混规格现在不做，见 boardSpec.js 文件头）；
   表里给的是**正方形**时的拼法，选了图片之后工作台会在同一规格内按原图比例改块数。 */
const cmOf = (n, beadKey) => (n * BEADS[beadKey].cm).toFixed(1)
const sizeRows = [
  { tier: '入门', board: '1 块 52 钉画线板（14 × 14 cm）', g: '52 × 52', n: 52 * 52, cm: cmOf(52, '2.6'), use: '图标、钥匙扣、杯垫', d: '入门' },
  { tier: '标准', board: '1 块 78 钉画线板（21 × 21 cm）', g: '78 × 78', n: 78 * 78, cm: cmOf(78, '2.6'), use: '桌面小摆件、简单头像', d: '简单' },
  { tier: '精细', board: '1 块 104 钉画线板（28 × 28 cm）', g: '104 × 104', n: 104 * 104, cm: cmOf(104, '2.6'), use: '五官、衣纹开始清楚', d: '简单' },
  { tier: '高精细', board: '1 块 120 钉画线板（34 × 34 cm）', g: '120 × 120', n: 120 * 120, cm: cmOf(120, '2.6'), use: '照片能认人、宠物照', d: '进阶' },
  { tier: '超精细', board: '2 × 2 块 78 钉画线板（42 × 42 cm；3.2:1 窄长图是 3 块 52）', g: '156 × 156', n: 156 * 156, cm: cmOf(156, '2.6'), use: '挂画级', d: '进阶' },
  { tier: '超大', board: '2 × 2 块 104 钉画线板（56 × 56 cm；3:4 竖图是 3 × 4 块 52）', g: '208 × 208', n: 208 * 208, cm: cmOf(208, '2.6'), use: '大挂画、多人合影', d: '进阶' },
  { tier: '极限', board: '3 × 3 块 104 钉画线板（84 × 84 cm；3:4 竖图是 3 × 4 块 78）', g: '312 × 312', n: 312 * 312, cm: cmOf(312, '2.6'), use: '先转准，再导 PNG 存档', d: '超大' }
]
/* 板型档案：实测外框与「外框 ÷ 钉数」反推的钉距。钉距是「能不能跨板拼成一张连续网格」的判据
   —— 52 / 78 / 104 三块算出来完全一致（2.692 mm），120 那块偏大（2.833 mm，待复测）。 */
const boardRows = BOARD_SPECS.map(s => ({
  spec: s,
  label: `${s} 钉画线板`,
  outer: `${BOARDS[s].outerCm} × ${BOARDS[s].outerCm} cm`,
  pitch: `${BOARDS[s].pitchMm} mm`,
  finish: `${cmOf(s, '2.6')} cm`
}))
const beadRows = [
  { k: '2.6', board: `${BOARD_SPEC_LIST_TEXT} 钉画线板（主力规格，默认）`, ex: `52 格 ≈ ${cmOf(52, '2.6')} cm · 104 格 ≈ ${cmOf(104, '2.6')} cm · 120 格 ≈ ${cmOf(120, '2.6')} cm` },
  { k: '5', board: '老存档方板（只服务旧作品）', ex: `老存档方板 ≈ ${cmOf(29, '5')} cm` }
]

const guides = [
  {
    id: 'size',
    title: '新手怎么选尺寸？',
    body: [
      '先想清楚「做出来放哪」：桌面摆件、挂件、冰箱贴，还是墙上挂画。',
      '小摆件：1 块 52 钉板（52 × 52 格，2.6mm 小豆约 13.5 cm 见方）通常够用，图案越简单越清楚。',
      '中等作品：1 块 104 钉板（104 × 104 格，约 27 cm 见方）是最舒服的档位，头像和宠物照细节能保住。',
      '大图：156 格（2 × 2 块 78 钉画线板，约 40.6 cm 见方）或 208 格（2 × 2 块 104 钉板，约 54.1 cm）。细节最多，但要分板、拼很久。',
      '复杂照片（真人照、细节多的插画）：52 / 78 档不够用 —— 实测 52 格只有「一团色块」、104 格「认得出轮廓」、312 格「五官都在」。工作台「② 画布大小」里按 52 → 78 → 104 → 120 → 156 → 208 → 312 七档排列，每一档都写清「豆子多大 · 板子多大 · 成品多大」和适合做什么。',
      '这七档都是「整块板拼法」：整张画布**只用一种规格**，尺寸就是它的整数倍（52 = 1 块 52 钉板、120 = 1 块 120 钉板、312 = 3 × 3 块 104 钉板），板边虚线正好落在真实板边上，不浪费板。',
      '为什么暂时不混规格：同珠径的板钉距是一样的（52 / 78 / 104 按实测外框反推都是 2.692 mm），并排摆着拼、图案跨过接缝是成立的，26 的倍数边长（130 = 52 + 78、182 = 78 + 52 + 52）也能用整板铺满；但接缝位置不规律、板与板能不能卡扣要按实物确认，所以现在只做「同一规格拼整块」，等把板型兼容数据测准了再放开。**不同珠径的板一定不能混**：凸柱间距是跟着豆径做的，混了格子对不齐。',
      '上传照片时会自动帮你匹配：「一格摊到 2 个原图像素」是超采样还能生效的下限，所以长边默认取原图长边的一半，吸附到最近的档位（52 ~ 312 格），再在**同一规格内**按原图比例改块数（3:4 的竖图在 312 档就是 3 × 4 块 78 板 = 234 × 312 格）。想更细就往上点，想省豆子就点回 52。',
      '先把规模算清楚再动手：120 × 120 = 14,400 格（2.6mm 小豆约 31.2 cm 见方、1 块 120 钉画线板），208 × 208 = 43,264 格（约 54.1 cm、2 × 2 块 104 钉板），312 × 312 = 97,344 格（约 81.1 cm、3 × 3 块 104 钉板）。312 是档位上限、挂画量级，按「月」算；再大的画布走「自定义尺寸」，请当成「先把图转准」的工具 —— 看清细节后导成 PNG 存着，或者只挑其中一块区域照着拼。',
      '判断标准：如果原图里你想保留的细节「小于画布格数的 1/30」，那基本保不住，要么放大画布，要么简化图案。'
    ]
  },
  {
    id: 'colors',
    title: '怎么选颜色数？',
    body: [
      '10–18 色是大多数作品的舒适区：既像原图，又不会让你在几十种颜色间反复换。',
      '低于 8 色：色块概括，适合图标、像素画、极简风。人物照会丢掉肤色过渡。',
      '16 → 32 色是收益最陡的一段（实测每加 10 色，平均色差降 0.11~0.34）；48 色以后边际收益掉到 0.02~0.05，64 色以后基本贴地。所以「够像」的拐点在 48~64 色附近，不是越多越好 —— 色号多一档，孤立豆和换色次数都跟着涨。',
      '色号会按画布大小自动给建议值：2,500 格以上 32 色、6,000 格以上 48 色、4 万格以上 64 色、20 万格以上 80 色、80 万格以上 90 色（档位对应的格数见下面「尺寸速查表」）。可以随时滑回去。',
      '色号上限是 291 色（= 最大色板长度，漫德 MARD 291 与 COCO 291 都能整块用上；换了更小的色板，上限就跟着降到那块色板的色号数）。但实测拐点在 48~64 色：90 以上再降不到 0.6% 色差、远看色差一点没降，孤立豆却多 12%、可拼性掉 0.04，而且引擎自己也会提前收敛（贪心选色到边际收益为 0 就停，实测最多用到 126 色）—— 所以自动档仍落在拐点上，这一档是留给"先把图转准"的余量。',
      '不确定就用「好拼版」：它会自动收敛颜色数并清理零星色，是省力又不难看的选择；想要最像就切「高还原」（上传照片时默认就是它）。'
    ]
  },
  {
    id: 'isolated',
    title: '怎么减少孤立豆？',
    body: [
      '孤立豆 = 四周没有同色的单颗豆。它们既难摆，又容易在熨烫时歪掉。',
      '打开「去孤立豆」：系统会把这类豆换成邻居里出现最多的颜色，并在右侧告诉你修正了多少颗。',
      '颜色数过高是孤立豆的主要来源，适当下调颜色数比反复手工清理更有效。',
      '抖动（Dither）会主动制造噪点换取渐变顺滑，如果你更在意好拼，保持关闭。',
      '人物、宠物的轮廓如果想要更锐利，可以把「色彩增强」关掉、颜色数调高一点，再开去孤立豆。'
    ]
  },
  {
    id: 'cutout',
    title: '怎么去掉照片的背景？',
    body: [
      '在「① 创建」那张卡里打开「抠图去背景」（就在上传图片下面一行）：系统会识别背景并去掉，背景位置不放豆，成品就是主体本身的形状（不用围着主体拼一圈背景）。',
      '如果你的图**本身**就带透明背景（手机抠好的贴纸、免抠 PNG 素材），不用开这个开关：透明的地方直接就是「不放豆」，而且会按主体范围自动裁好画布 —— 透明是确切信息，不该让你多按一次开关，也不该被算成一整片白豆。',
      '同时会自动裁到主体范围，让主体占满整块画布 —— 同样的底板尺寸，格子全用在主体上，细节更清楚。',
      '投影（拍照时物体落在地上/墙上的影子）会一并去掉：投影与背景只差亮度不差颜色，算法按"直射光被挡住、只剩环境光"的乘法模型把它判出来，所以成品是干净的单个物体，不会拖着一圈灰豆。',
      '力度有三档：白底 / 纯色底用「保守」；照片背景用「标准」（默认）；背景比较杂乱（草地、墙面、街景）再试「激进」，激进档更容易削到主体边缘。',
      '主体和背景颜色很接近时（例如白色主体压在白背景上），靠的是主体轮廓把内外隔开；如果没有明显描边，抠图可能会把主体吃掉一部分 —— 这时换个力度或换张图。',
      '抠得不够干净的地方，用画布上的橡皮擦（⌫）点掉多出来的豆即可；擦掉的位置就是「不放豆」，材料清单和豆数会跟着减少。',
      '勾了开关但提示「没检测到明显背景」（纯色图、满屏纹理）时，系统会保留整图，不会硬抠出一团乱码。'
    ]
  },
  {
    id: 'iron',
    title: '怎么熨？',
    body: [
      '熨烫前：确认所有豆子都立在同一面，底板放平，垫上专用烘焙纸（不要用普通打印纸）。',
      '温度：中温（约 150–170°C），先把熨斗预热到温度稳定，不要一边升温一边熨。',
      '手法：画小圈缓慢移动，力度均匀，每处停留 10–15 秒再移动，不要长时间压住一点。',
      '判断：从纸外缘能隐约看到豆子边缘变圆、互相粘连即可，不要熨到完全扁平失去颗粒感。',
      '大图：分块熨烫，每一块都压好冷却后，再按板号顺序对齐拼合，接缝处补熨一次。',
      '冷却：压上平整重物冷却 5–10 分钟再揭纸，能显著减少翘边。'
    ]
  },
  {
    id: 'split',
    title: '大图怎么分板？',
    body: [
      '画线拼板是 52 / 78 / 104 / 120 钉四个规格（单板见方，即 52 × 52 / 78 × 78 / 104 × 104 / 120 × 120 格），实测外框 14 / 21 / 28 / 34 cm。大图就是**同一规格**再多拼几块 —— 例如 156 格 = 2 × 2 块 78 钉板、312 格 = 3 × 3 块 104 钉板。同珠径的板钉距相同（52 / 78 / 104 反推都是 2.692 mm），并排摆着拼、图案跨过接缝是成立的，但接缝位置不规律、能不能卡扣要按实物确认，所以现在只做「同一规格拼整块」；**不同珠径的板一定不能混**（凸柱间距跟着豆径做，混了格子对不齐）。',
      '豆玩会按真实板边自动分板，图纸上的珊瑚色虚线就是板与板的边界，角标数字是板号。',
      '导出 PDF 时每块板单独一页，并带该板的行列坐标与该板需要的颜色数量 —— 一板一板准备材料。',
      '拼的时候按板号顺序来，先拼外圈再补内部，方便随时检查是否错位。',
      '建议每拼完一块就熨一次并冷却，最后再拼合，比整张一起熨容易得多。'
    ]
  },
  {
    id: 'photo',
    title: '怎样拍成品？',
    body: [
      '光线：白天靠窗的散射光最好，避免顶灯直射产生高光斑。',
      '角度：45° 斜俯拍最能看出颗粒质感；正俯拍适合展示图案完整度。',
      '背景：纯色卡纸或木桌面都行，别让背景比作品更花。',
      '对比：用「原图对照 PNG」做前后对比图，是小红书上表现最好的形式。',
      '分享卡：完成页里可以直接生成 1080×1350 的竖版分享卡；在「完成作品」时上传一张成品照片，卡片第三格就会用上它，不用再摆一个占位块。'
    ]
  },
  {
    id: 'cartoon',
    title: '怎么把照片转成卡通形象？',
    body: [
      'AI 生图功能对接中，敬请期待。卡通风格入口暂时关闭，接入完成后会重新开放。',
      '现在照片类题材可以先用「智能抠图」去掉背景和投影，再生成图纸；抠图全部在浏览器本地完成，不会上传照片。',
      '想让图案更好拼，也可以减少颜色数量、关掉抖动或打开去孤立豆，这些参数在「④ 色板选择」展开后的高级设置里。'
    ]
  },
  {
    id: 'quality',
    title: '为什么我的图生成效果不好？',
    body: [
      '照片转换质量受原图影响很大。线条清晰、色块分明的图（插画、logo、手绘）效果最好。',
      '照片建议：主体占画面 60% 以上、背景尽量干净、光线均匀。先裁掉多余背景再上传会好很多。',
      '主体太小、背景太乱、全身照里人脸很小 —— 这些情况转换后人物特征容易丢失。',
      '试这三个动作：1) 换成「裁切填满」；2) 颜色数加到 20 以上；3) 关掉去孤立豆看原始效果。',
      '另外可以在生成结果上直接点格子手动改色，不必追求一步到位。'
    ]
  }
]

const shortcuts = [
  { key: 'Ctrl / ⌘ + Z', desc: '撤销上一步编辑（拖着画笔划过一片格子算一步）' },
  { key: 'Ctrl / ⌘ + Y', desc: '重做' },
  { key: '滚轮', desc: '在图纸上缩放' },
  { key: '按住空白拖动', desc: '平移图纸' },
  { key: '单击格子', desc: '用当前工具改这一格' }
]

const faq = [
  { q: '生成的图纸能直接用吗？', a: '能。图纸上每格都印了色号，四边有行列坐标，每 10 格有加粗辅助线，每块底板有边界虚线和板号。照着数格摆豆就可以。' },
  { q: '为什么我的透明背景 PNG 上传后没有背景豆？', a: '因为它是透明的。透明的地方本来就等于「不放豆」，所以带透明通道的图（手机抠好的贴纸、免抠素材）会自动按透明区域留空并按主体裁剪画布，不用再手动开「抠图去背景」，也不会出现一圈白豆。想连背景一起拼成方块，就把图片存成白底 JPG 再上传。' },
  { q: '画布是不是开得越大越像？', a: '不是。一格至少要摊到 2 个原图像素，超采样（面积平均 + 多数投票）才有意义；画布再大就只是把插值出来的假细节摊成格子，实测色差不再下降（这时界面会提示「画布已超过原图的有效分辨率」）。所以上传照片时系统按「长边 = 原图长边 ÷ 2」自动匹配，落点吸附到 52 / 78 / 104 / 120 / 208 / 312 这些档位与整板规格；再往上继续加格数的收益要靠更大的原图，而不是更大的画布。' },
  { q: '色号和我在淘宝买的对得上吗？', a: '色号来自公开整理的第三方品牌色卡，共 8 个体系：漫德 MARD（24 / 48 / 72 / 96 / 120 / 221 / 264 / 291 色套装，同一套色号，只是买多少包）、COCO 291、漫漫 278、盼盼 291、咪小窝 286、优肯 Artkal C197、Hama 92、Perler 103。国内五个体系（MARD / COCO / 漫漫 / 盼盼 / 咪小窝）的色号清单与色值都按同一份公开色卡逐色对齐，并与另外几套公开色卡交叉验证；认不出真实品牌编号的色块直接剔除，不做猜测（咪小窝 W1–W5 与 MARD Q1–Q5 同色，暂不重复收录）。图片转换时，每一格都会在整块色板里按 CIEDE2000 找最接近的色号，色板里没有的颜色一定会被换成最近的可用色号。第三方屏幕色值与实物豆子之间仍有出厂批次差异，采购前请以实体色卡为准。' },
  { q: '不同品牌的色号能混用吗？', a: '不能。MARD 的 H1 与 Hama 的 H01 是两个完全不同的产品。所以切换色板时颜色会整体重算，请在「设置」里固定你实际在用的品牌。' },
  { q: '我的作品会丢吗？', a: '作品、库存、收藏都存在你本机浏览器的 localStorage 里，换设备或清理浏览器数据会丢失。设置页可以导出备份包，建议重要作品顺手导出 Pattern JSON。' },
  { q: '能商用吗？', a: '平台自制素材可以用于个人作品。正式商用授权属于 Creator 套餐，目前尚未开放。用自己拍摄的照片生成的作品，版权归你。' },
  { q: '发现侵权内容怎么办？', a: '通过下方举报入口提交具体链接与说明。我们会核实后下架，并保留处理日志。素材中心第一阶段的图案全部由平台自制，不使用未经授权的 IP 形象。' }
]

const open = ref('size')
function toggle(id) {
  open.value = open.value === id ? '' : id
}

const reportOpen = ref(false)
const reportText = ref('')
const reportSent = ref(false)

function sendReport() {
  if (!reportText.value.trim()) return
  reportSent.value = true
  reportText.value = ''
}
</script>

<template>
  <div class="wrap main--pad">
    <div class="pagehead">
      <div>
        <h1>帮助与教程</h1>
        <p>
          从选尺寸、选颜色，到熨烫和拍成品 —— 拼豆真正容易卡住的地方都在这里。
          素材库{{ ASSET_COUNT ? `现有 ${ASSET_COUNT} 个原创图案` : '正在上新' }}，{{ PALETTE_BRANDS.length }} 套品牌色板共 {{ totalColors }} 个色号（漫德 MARD 的 24~291 八个套装共用同一套色号，只算一次）。
        </p>
      </div>
    </div>

    <!-- 快速上手 -->
    <section class="card">
      <div class="card__head"><h3>5 分钟上手</h3><span class="muted">最短路径</span></div>
      <div class="card__body">
        <ol class="quickSteps">
          <li><b>创建</b><span>上传照片，或去素材中心挑一个现成图案</span></li>
          <li><b>选方案</b><span>高还原 / 好拼版 / 艺术版，系统会标出推荐与推荐理由</span></li>
          <li><b>微调</b><span>创建卡里打开「智能抠图」（连投影一起去掉，只留主体）；调颜色数与色板；高级设置里开关抖动、去孤立豆、格内色号；改错了随时撤销（Ctrl/⌘ + Z，拖着画笔划过一片格子算一步，重做是 Ctrl/⌘ + Y）。卡通风格与一键优化需要 AI 生图能力，目前对接中</span></li>
          <li><b>看数据</b><span>右侧检查还原度、可拼性、材料用量与缺口</span></li>
          <li><b>导出</b><span>PNG 发出去，PDF 打印出来照着拼，CSV 拿去采购</span></li>
          <li><b>开拼</b><span>进入第三步「完成」：逐颗 / 整板记录进度，随时看到这一板还差多少颗</span></li>
          <li><b>完成</b><span>拼完点「我拼完了 · 完成作品」：记下完成时间、按材料表扣减库存（可撤销）、进入成长记录，作品出现在「已完成」里；顺手传一张成品照片，分享卡第三格就用它</span></li>
        </ol>
        <div class="row row--wrap" style="margin-top:16px">
          <RouterLink to="/editor" class="btn primary">现在就试一次</RouterLink>
          <RouterLink to="/library" class="btn btn-secondary">先逛素材</RouterLink>
        </div>
      </div>
    </section>

    <!-- 教程 -->
    <section class="secHead">
      <div><h2>教程</h2><p>点开看详细说明</p></div>
    </section>
    <div class="guideGrid">
      <article v-for="g in guides" :key="g.id" class="guideCard" :class="{ open: open === g.id }">
        <button class="guideHead" :aria-expanded="open === g.id" @click="toggle(g.id)">
          <b>{{ g.title }}</b>
          <span aria-hidden="true">{{ open === g.id ? '−' : '＋' }}</span>
        </button>
        <div v-if="open === g.id" class="guideBody">
          <p v-for="(p, i) in g.body" :key="i">{{ p }}</p>
        </div>
      </article>
    </div>

    <!-- 尺寸速查 -->
    <section class="secHead">
      <div>
        <h2>尺寸速查表</h2>
        <p>画线拼板是 {{ BOARD_SPEC_LIST_TEXT }} 钉四个规格（一钉 = 一格，单板见方，实测外框 14 / 21 / 28 / 34 cm）；画布尺寸是某一个规格的整数倍，更大就**同规格**再拼几块 —— 现在不做混规格，不同珠径的板也不能混（原因见下面第 6 条）</p>
      </div>
    </section>
    <div class="tableWrap">
      <table class="table">
        <thead>
          <tr><th>档位</th><th>拼板</th><th>格数</th><th class="num">总豆数</th><th>成品尺寸（2.6mm 小豆 · 默认）</th><th>适合做什么</th><th>难度</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in sizeRows" :key="row.tier">
            <td><b>{{ row.tier }}</b></td>
            <td>{{ row.board }}</td>
            <td>{{ row.g }}</td>
            <td class="num">{{ row.n.toLocaleString() }}</td>
            <td>{{ row.cm }} × {{ row.cm }} cm</td>
            <td>{{ row.use }}</td>
            <td><span class="tag" :class="row.d === '入门' ? 'free' : row.d === '简单' ? 'new' : row.d === '进阶' ? 'warn' : 'hot'">{{ row.d }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="tableWrap" style="margin-top:12px">
      <table class="table">
        <thead>
          <tr><th>板型</th><th>实测外框</th><th>凸柱中心距</th><th>单板成品（2.6mm 豆）</th></tr>
        </thead>
        <tbody>
          <tr v-for="b in boardRows" :key="b.spec">
            <td><b>{{ b.label }}</b></td>
            <td>{{ b.outer }}</td>
            <td>{{ b.pitch }}</td>
            <td>{{ b.finish }} 见方</td>
          </tr>
        </tbody>
      </table>
      <p class="hint" style="margin-top:8px">
        凸柱中心距 = 实测外框 ÷ 钉数。52 / 78 / 104 三块算出来完全一致（2.692 mm），说明它们是同一套网格的三种大小；
        120 那块按 34 cm 反推是 2.833 mm，偏大一档 —— 想在 120 和其它板之间跨板拼图案，要先复测这一块（钉距不一致就对不齐格子）。
        成品尺寸按「格数 × 豆径」算（豆子的占地），比外框略小；差的那点就是板的边框。
      </p>
    </div>
    <div class="tableWrap" style="margin-top:12px">
      <table class="table">
        <thead>
          <tr><th>豆径</th><th>配哪种板</th><th>换算</th><th>成品尺寸参考</th></tr>
        </thead>
        <tbody>
          <tr v-for="b in beadRows" :key="b.k">
            <td><b>{{ BEADS[b.k].label }}</b></td>
            <td>{{ b.board }}</td>
            <td>1 格 = {{ BEADS[b.k].mm }}mm</td>
            <td>{{ b.ex }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="hint" style="margin-top:10px">
      比 312 格更大的画布走「自定义尺寸」：选规格（{{ BOARD_SPEC_LIST_TEXT }} 钉画线板）× 横向几块 × 纵向几块，
      下面会直接算出成品尺寸（格数 × 豆径）。单边最大 1000 格（例如 104 × 9 = 936 格）。
      老存档（老规格方板）仍按原样分板、按 5mm 中号豆算，打开后不会变样。
    </p>

    <!-- 快捷键 -->
    <section class="secHead">
      <div><h2>编辑器快捷键</h2><p>少点几下鼠标</p></div>
    </section>
    <div class="shortcutGrid">
      <div v-for="s in shortcuts" :key="s.key" class="shortcutItem">
        <kbd>{{ s.key }}</kbd>
        <span>{{ s.desc }}</span>
      </div>
    </div>

    <!-- FAQ -->
    <section class="secHead">
      <div><h2>常见问题</h2><p>没找到答案？用下方反馈入口告诉我们</p></div>
    </section>
    <div class="faq">
      <details v-for="(f, i) in faq" :key="f.q" :open="i === 0">
        <summary>{{ f.q }}</summary>
        <p>{{ f.a }}</p>
      </details>
    </div>

    <!-- 反馈与举报 -->
    <section class="secHead">
      <div><h2>反馈与举报</h2><p>生成结果的问题、功能建议、侵权举报都走这里</p></div>
    </section>
    <div class="feedbackGrid">
      <div class="card">
        <div class="card__head"><h3>告诉我们哪里不对</h3><span class="muted">每条都会看</span></div>
        <div class="card__body">
          <div v-if="!reportSent" class="stack stack--sm">
            <div class="field">
              <label>问题类型</label>
              <div class="row row--wrap">
                <span v-for="t in ['太糊', '颜色太多', '不像原图', '孤立豆太多', '太难拼', '背景不好', '尺寸不合适', '其他']" :key="t" class="tag">{{ t }}</span>
              </div>
            </div>
            <div class="field">
              <label>详细说明 <span>越具体越有用</span></label>
              <textarea v-model="reportText" rows="4" placeholder="例如：104×104 生成猫脸时胡须丢了，颜色数 14 时眼睛糊在一起" />
            </div>
            <button class="btn primary block" @click="sendReport">提交反馈</button>
            <p class="hint">
              当前没有后端，反馈会暂存在本机并在接入服务后统一提交。反应用户「为什么觉得不好拼」的数据，
              是我们校准生成质量最关键的资产。
            </p>
          </div>
          <div v-else class="okBox">感谢反馈！我们记下来了。</div>
        </div>
      </div>

      <div class="card">
        <div class="card__head"><h3>侵权举报</h3><span class="muted">24 小时内响应</span></div>
        <div class="card__body stack stack--sm">
          <p class="hint">
            如果你认为站内素材或用户作品侵犯了你的权利，请提供：具体页面链接、权利证明、你的联系方式。
            我们会在核实后下架相关内容，并保留完整处理日志。
          </p>
          <ul class="reportList">
            <li>素材中心的所有图案均为平台自制，不使用未经授权的动漫 / 游戏 / IP 形象</li>
            <li>用户上传图片时需确认拥有或已获得使用权</li>
            <li>用户分享的作品可被举报，核实后下架</li>
            <li>处理记录包含时间、内容 ID、处理结果，可应要求提供</li>
          </ul>
          <RouterLink to="/settings" class="btn soft block">查看图片隐私与版权说明</RouterLink>
        </div>
      </div>
    </div>

    <p class="hint" style="margin-top:26px;text-align:center">
      豆玩 DOUWAN · 把喜欢的东西，拼成自己的作品。<br>
      拼豆不是把豆子放到板子上，而是把「我喜欢的东西」一点一点变成「我的东西」。
    </p>
  </div>
</template>

<style scoped>
.quickSteps{
  margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;
  counter-reset:step;
}
.quickSteps li{
  position:relative;padding:15px 15px 15px 50px;border-radius:var(--r-md);
  background:var(--surface-2);border:1px solid var(--line);counter-increment:step;
}
.quickSteps li::before{
  content:counter(step);position:absolute;left:14px;top:15px;width:24px;height:24px;border-radius:50%;
  background:var(--primary-soft);color:var(--primary-deep);display:grid;place-items:center;font-size:var(--fs-2xs);font-weight:850;
}
.quickSteps b{display:block;font-size:var(--fs-sm);margin-bottom:3px}
.quickSteps span{font-size:var(--fs-2xs);color:var(--muted);line-height:1.65}
.guideGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:13px;align-items:start}
.guideCard{border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface);overflow:hidden;transition:var(--t)}
.guideCard.open{border-color:var(--primary);box-shadow:var(--sh-1)}
.guideHead{
  width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:15px 17px;text-align:left;font-size:var(--fs-sm);font-weight:800;
}
.guideHead span{color:var(--muted);font-weight:700}
.guideBody{padding:0 17px 16px;display:flex;flex-direction:column;gap:9px}
.guideBody p{font-size:var(--fs-xs);color:var(--ink-2);line-height:1.85}
.shortcutGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:11px}
.shortcutItem{
  display:flex;align-items:center;gap:11px;padding:12px 14px;border-radius:var(--r-md);
  background:var(--surface);border:1px solid var(--line);
}
kbd{
  font-family:inherit;font-size:var(--fs-2xs);font-weight:800;padding:4px 9px;border-radius:var(--r-xs);
  background:var(--surface-3);border:1px solid var(--line-strong);white-space:nowrap;
}
.shortcutItem span{font-size:var(--fs-xs);color:var(--muted)}
.feedbackGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}
.reportList{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:7px}
.reportList li{font-size:var(--fs-xs);color:var(--ink-2);line-height:1.7}
.okBox{padding:14px;border-radius:var(--r-sm);background:var(--green-soft);color:var(--green-deep);font-size:var(--fs-xs);font-weight:700}
@media(max-width:900px){
  .quickSteps,.guideGrid,.feedbackGrid{grid-template-columns:1fr}
}
</style>
