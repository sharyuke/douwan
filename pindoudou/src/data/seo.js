/* =========================================================================
   SEO 文案（单一事实来源）
   -------------------------------------------------------------------------
   这份文件同时喂给三个地方，保证「爬虫看到的」和「用户看到的」是同一份：
     1. scripts/build-seo-pages.mjs 把它编译成 dist/seo/pages.json，
        后端渲染爬虫可见的 HTML 时直接读这份 JSON；
     2. 前端路由切换时用它更新 title / description / canonical / OG；
     3. 后台「SEO 管理」的页面清单里显示的也是它。
   规则：只写真实存在的能力，不编下载量、不编用户评价、不编评分。
   ========================================================================= */

import { BUILD_TOOL_CONTENT } from './tools.js'

/** 站点级信息。name / slogan 与页脚、顶栏保持一致。 */
export const SITE_SEO = {
  name: '豆玩 DOUWAN',
  slogan: '所爱皆可拼，万物皆可造',
  url: 'https://dw.sharyuke.com',
  logo: '/favicon.png',
  ogImage: '/og-cover.png',
  description:
    '豆玩是一站式拼豆创作平台。支持上传图片一键生成拼豆图纸、像素画转换、拼豆色号匹配、材料数量统计及图纸导出。提供免费拼豆素材，手机电脑均可使用。',
  keywords: [
    '豆玩',
    '拼豆图纸生成器',
    '图片转拼豆',
    '免费拼豆图纸',
    '拼豆图纸',
    '拼豆素材',
    '拼豆色号',
    '拼豆教程'
  ]
}

/** 首页。H1 与首页 sr-only 标题一致（首页主视觉是一张标题图，文字标题对读屏与爬虫可见）。 */
export const HOME_PAGE = {
  path: '/',
  kind: 'home',
  title: '豆玩 - 免费拼豆图纸生成器｜图片转拼豆图纸在线制作',
  description:
    '豆玩是一站式拼豆创作平台。支持上传图片一键生成拼豆图纸、像素画转换、拼豆色号匹配、材料数量统计及图纸导出。提供免费拼豆素材，手机电脑均可使用。',
  h1: '免费拼豆图纸生成器',
  lead:
    '把灵感拼成喜欢的样子。上传一张图片，在浏览器里直接生成拼豆图纸：自动配色、匹配品牌色号、统计材料用量、按真实底板分板打印。全部功能免费，手机和电脑都能用。',
  intro: [
    '豆玩把「照片 → 拼豆图纸」这件事搬进了浏览器。上传的图片只在你自己的设备上处理，不会上传到服务器，也不需要注册账号，想转多少张就转多少张。',
    '生成之后你可以直接导出 PNG 图纸、按板分页的 PDF（带行号列号与每板用量）、采购用的 CSV 色号清单；拼装阶段还有逐颗 / 整板的拼制进度和库存扣减。'
  ],
  features: [
    {
      icon: 'sparkles',
      title: '图片一键转拼豆图纸',
      body: '上传 JPG / PNG / WebP / GIF，自动抠背景、去投影、感知色彩量化，输出带色号的网格图纸。'
    },
    {
      icon: 'palette',
      title: '真实品牌色号',
      body: '内置漫德 MARD、COCO、漫漫、盼盼、咪小窝、优肯 Artkal、Hama、Perler 等品牌色板，图纸上印的就是你要买的那个编号。'
    },
    {
      icon: 'layers',
      title: '按真实底板分板',
      body: '52 / 78 / 104 / 120 钉画线板整数倍分板，图纸上的边界线正好落在真实板边上，买板拼板不会错位。'
    },
    {
      icon: 'list',
      title: '材料清单与用量',
      body: '每种颜色要多少颗自动算好，输出能直接拿去下单的采购清单。'
    },
    {
      icon: 'lock',
      title: '浏览器本地处理',
      body: '解码、缩放、量化、渲染全部在本地完成，照片不会离开你的设备，也没有次数限制。'
    },
    {
      icon: 'sparkles',
      title: '免费素材库',
      body: '萌宠、二次元、美食水果、植物花卉等原创素材全部免费，选中一张就能直接生成图纸。'
    }
  ],
  steps: [
    { title: '上传图片', body: '选一张照片，或从免费素材库里挑一个原创图案。' },
    { title: '选方案与尺寸', body: '系统给出高还原 / 好拼版 / 艺术版三个方案并说明推荐理由，尺寸可按底板规格调整。' },
    { title: '微调颜色', body: '想更接近原图就把颜色数调高，想更好拼就调低；也可以点格子手动改色。' },
    { title: '导出并开拼', body: '导出 PNG / 分板 PDF / 色号清单，照着拼，拼完回作品页标记完成。' }
  ],
  sections: [
    {
      h: '免费拼豆图纸怎么生成',
      p: [
        '第一步是选图片。照片不用先裁剪，工具会按「一格至少摊到 2 个原图像素」自动落到合适的底板档位上；主体很小的时候，用「裁切填满」把主体放大，效果会明显变好。',
        '第二步是配色。豆玩默认走「好拼版」策略：先做感知色彩量化，再清理四周没有同色的孤立豆，颜色数通常收敛在 10~18 色。想更接近原图就把目标颜色数往上加（最多支持 291 色色板）。',
        '第三步是导出。PNG 适合分享和存档，PDF 按板分页、带每页的行号列号和用量清单，CSV 适合直接拿去采购。'
      ]
    },
    {
      h: '为什么选择豆玩做拼豆图纸',
      p: [
        '全部功能免费开放：三方案自动搜索与可拼性优化、大画布（52 → 312 共 6 档，更大的走自定义尺寸）、库存约束配色、分板 PDF、逐颗与整板拼制进度，都不需要开通或兑换。',
        '色号是真的。不同品牌的色号互不通用，豆玩按品牌分别维护色板，切换品牌时颜色会整体重算，这是正确行为而不是 bug。',
        '材料与底板也是真的：52 / 78 / 104 / 120 钉画线板是常见规格，配 2.6mm 小豆；大图按「规格 × 横向几块 × 纵向几块」自己加板。'
      ]
    },
    {
      h: '如何获取免费拼豆素材',
      p: [
        '在豆玩顶部导航点「免费素材库」，就能看到全部公开的拼豆素材。素材分二次元、萌宠动物、美食水果、情侣情感、植物花卉、生活美学、节日祝福、萌趣日常、新手专区九类，每一类下面还有更细的标签可以直接筛。',
        '选中一张素材会直接进入工作台，自动给出高还原 / 好拼版 / 艺术版三个方案，并按你手里的底板规格算好分板。',
        '所有素材都免费，不需要开通会员，也没有下载次数限制；素材页底部会给出相关素材推荐，可以一路逛下去。'
      ]
    }
  ],
  /* 常见问题：问句与答句分开，后台与服务端渲染成结构化的问答块 */
  faq: [
    {
      q: '生成的图纸颜色和实物差得多吗？',
      a: '屏幕上的色值只是色卡的近似值，不同批次、光线和显示器都会有色差，采购前请以实体色卡为准。'
    },
    {
      q: '为什么颜色数比我要的少？',
      a: '引擎会在「边缘收益为零」时提前收敛，这是为了避免图纸里出现大量只差几颗豆的近似色。想强行拉高色数可以在设置里调高目标颜色数。'
    },
    {
      q: '图片会上传到服务器吗？',
      a: '不会。解码、缩放、量化、渲染全部在你的浏览器里完成，照片不离开你的设备。'
    },
    {
      q: '色号能直接拿去采购吗？',
      a: '可以。图纸上的每一格都印着品牌色号，导出的 CSV 色号清单可以直接拿去下单。'
    },
    {
      q: '素材真的免费吗？有次数限制吗？',
      a: '素材全部免费开放，不需要开通会员，也没有下载次数限制。'
    }
  ],
  links: [
    { href: '/materials/', text: '免费拼豆素材库' },
    { href: '/help/', text: '拼豆教程与常见问题' },
    { href: '/tools/photo-to-bead-pattern/', text: '照片转拼豆图纸' },
    { href: '/tools/pixel-bead-maker/', text: '像素拼豆图纸生成器' },
    { href: '/colors/', text: '拼豆色号与色卡对照' },
    { href: '/', text: '开始制作拼豆图纸' }
  ]
}

/** 教程页（对应前台「帮助与教程」）。 */
export const HELP_PAGE = {
  path: '/help/',
  kind: 'help',
  title: '拼豆教程与常见问题 - 豆玩',
  description:
    '拼豆新手教程：从选尺寸、选颜色，到熨烫和拍成品的完整步骤，附底板尺寸速查表、编辑器快捷键与常见问题解答。豆玩帮你在手机上也能做出专业拼豆图纸。',
  h1: '拼豆教程与常见问题',
  lead: '从选尺寸、选颜色，到熨烫和拍成品——拼豆真正容易卡住的地方都在这里。',
  intro: [
    '这份教程按「新手第一次做 → 做出能发朋友圈的成品」的顺序写。每一节都能独立看：只关心熨烫就直接跳到那一节。',
    '所有尺寸、底板规格与色号都来自豆玩工作台的真实数据，图纸上的数字与这里写的一致。'
  ],
  features: [
    { icon: 'list', title: '教程', body: '分步骤讲：怎么选豆、怎么分板、怎么熨烫、怎么记录完成。' },
    { icon: 'layers', title: '尺寸速查表', body: '52 / 78 / 104 / 120 钉画线板规格、外框尺寸与成品尺寸。' },
    { icon: 'sparkles', title: '编辑器快捷键', body: '少点几下鼠标的操作。' },
    { icon: 'list', title: '常见问题', body: '图纸不清晰、颜色太多、熨烫起皱怎么办。' }
  ],
  steps: [
    { title: '选图纸', body: '先定底板规格（52 / 78 / 104 / 120 钉），再选画布尺寸，尺寸要是规格的整数倍。' },
    { title: '准备材料', body: '按材料清单把色号和豆子找齐，数量比图纸上多备 10% 更保险。' },
    { title: '拼装', body: '一板一板摆，图纸四边的行号列号就是板上的格号。' },
    { title: '熨烫与完成', body: '垫烘焙纸、中温、均匀用力；拼完回作品页标记完成，自动扣库存。' }
  ],
  sections: [
    {
      h: '底板与尺寸怎么选',
      p: [
        '画线拼板常见规格是 52 / 78 / 104 / 120 钉，一钉 = 一格，单板见方。豆玩的画布档位都落在这四个规格上：52、78、104、120，以及 208（2 × 2 块 104 钉板）、312（3 × 3 块 104 钉板）。',
        '更大的画布走「自定义尺寸」，按同一个规格一块一块加，单边最大 1000 格。不同珠径的板不能混用，混规格会导致成品尺寸对不上。'
      ]
    },
    {
      h: '熨烫与成品处理',
      p: [
        '熨烫时一定要垫烘焙纸，熨斗温度用中档，压力均匀地从中间往四周推。',
        '拼歪了可以趁热用镊子轻推调整；已经冷却的成品用吹风机热风档局部加热后再修。'
      ]
    }
  ],
  links: [
    { href: '/', text: '免费拼豆图纸生成器' },
    { href: '/materials/', text: '免费拼豆素材库' },
    { href: '/tools/photo-to-bead-pattern/', text: '照片转拼豆图纸' }
  ]
}

/** 素材中心（分类与详情页由后端按真实数据渲染，这里只放中心页的兜底文案）。 */
export const MATERIALS_PAGE = {
  path: '/materials/',
  kind: 'materials',
  title: '免费拼豆素材库 · 拼豆图纸素材大全 - 豆玩',
  description:
    '豆玩素材库提供免费拼豆素材与拼豆图纸，覆盖萌宠、二次元、美食水果、植物花卉等分类，支持在线转拼豆图纸、匹配色号并导出打印。',
  h1: '免费拼豆素材库',
  lead: '所有素材免费使用，选中一张就能在浏览器里直接生成拼豆图纸。',
  intro: [
    '素材均为豆玩平台原创或已获得授权，全部免费开放。选中素材后会直接载入工作台，自动生成高还原 / 好拼版 / 艺术版三个方案。',
    '每一张素材都有独立页面，可以在浏览器里直接打开，也能分享给别人。'
  ],
  links: [
    { href: '/help/', text: '拼豆教程与常见问题' },
    { href: '/tools/photo-to-bead-pattern/', text: '照片转拼豆图纸' }
  ]
}

/**
 * 工具页从 src/data/tools.js 的 BUILD_TOOL_CONTENT 生成。
 * 这里只放「怎么把工具内容转成 SEO 页面」与「标题 / 描述的写法」。
 */
export const TOOL_SEO_DEFAULTS = {
  kind: 'tool',
  /* 描述长度控制在 120 字以内：超过后搜索结果里会被截断 */
  descriptionMax: 120
}

/** 按字符数截断（中文按字算），超出加省略号。 */
export function truncateText(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  const arr = Array.from(s)
  if (arr.length <= max) return s
  return arr.slice(0, max - 1).join('') + '…'
}

/** 工具内容 → SEO 页面（前端与构建脚本共用，保证两边一致）。 */
export function toolPageMeta(tool) {
  if (!tool || !tool.slug) return null
  return {
    path: `/tools/${tool.slug}/`,
    kind: 'tool',
    title: `${tool.h1} - 免费在线生成拼豆图纸 - 豆玩`,
    description: truncateText(
      `${tool.lead} 免费在线生成带色号的拼豆图纸，自动分板并输出材料清单，手机电脑都能用。`,
      TOOL_SEO_DEFAULTS.descriptionMax
    ),
    h1: tool.h1,
    badge: tool.badge || '',
    lead: tool.lead || '',
    intro: [],
    features: tool.features || [],
    steps: tool.steps || [],
    sections: (tool.article || []).map(a => ({ h: a.h, p: a.p || [] })),
    links: [
      { href: '/', text: '免费生成一张图纸' },
      { href: '/materials/', text: '免费拼豆素材库' },
      { href: '/help/', text: '拼豆教程与常见问题' }
    ],
    keywords: SITE_SEO.keywords,
    og_image: SITE_SEO.ogImage,
    noindex: false
  }
}

/**
 * 色卡说明页（/colors/）。
 *
 * 这一页对应「拼豆色号」「拼豆色卡对照」「拼豆颜色匹配」这类搜索意图 ——
 * 用户在拼豆圈里最常卡住的就是「图纸上印的色号到底是哪个牌子的哪个号」。
 * 内容全部来自真实色板数据（src/data/palette.js），不含编造的规格。
 */
export const COLORS_PAGE = {
  path: '/colors/',
  kind: 'colors',
  title: '拼豆色号与色卡对照 - 各品牌真实色号表 - 豆玩',
  description:
    '豆玩整理的拼豆色号对照表：漫德 MARD、COCO、漫漫、盼盼、咪小窝、优肯 Artkal、Hama、Perler 等品牌的真实色号体系，说明色号怎么选、颜色怎么匹配，生成图纸时直接标出要买的编号。',
  h1: '拼豆色号与色卡对照',
  lead: '不同品牌的拼豆色号互不通用 —— A1 在漫德是浅黄，在别的品牌可能根本不存在。这里按品牌分别列出真实色号，并说明在豆玩里怎么把图纸上的颜色匹配成能买到的豆子。',
  intro: [
    '买豆子的时候，商家问的第一句往往是「什么牌子」。因为色号是品牌内部编号，不是通用编号：漫德的 A1、COCO 的 01、Hama 的 01，颜色可能完全不一样。',
    '豆玩的色板就是按品牌分开维护的。生成图纸时选定品牌，图纸上印出来的就是那个品牌能买到的编号 —— 换品牌会整体重算颜色，这是正确行为。'
  ],
  features: [
    { icon: 'palette', title: '按品牌分色板', body: 'MARD 24/48/72/96/120/221/264/291 八个套装共用同一份色值，换套装只增删色号，同一个色号颜色不变。' },
    { icon: 'layers', title: '套装只是数量不同', body: 'MARD 的八个套装是同一套色号体系的不同包装，色值完全一致；真正不同的品牌才有真正的色差。' },
    { icon: 'list', title: '图纸上直接印色号', body: '每格旁边标出品牌色号，导出 CSV 就是能直接下单的采购清单。' },
    { icon: 'eyedropper', title: '自动挑最接近的色', body: '按 CIEDE2000 色差在色板里找最接近的颜色，量化时就已经算好了，不是事后近似。' },
    { icon: 'lock', title: '屏幕色值只是近似', body: '不同批次、光线和显示器都会有色差，采购前请以实体色卡为准。' },
    { icon: 'inventory', title: '库存也能约束配色', body: '勾选手里真的有的颜色，生成时只在你有的色号里挑。' }
  ],
  steps: [
    { title: '选品牌', body: '按你手里的豆子选对应品牌；不知道就选漫德 MARD，国内最常见。' },
    { title: '选套装', body: '套装只影响可用色号的数量，不影响颜色本身。' },
    { title: '生成图纸', body: '上传图片或选素材，豆玩自动量化并把每格匹配到色板里的真实色号。' },
    { title: '按色号采购', body: '导出 CSV 色号清单，拿去搜同品牌的豆子即可。' }
  ],
  sections: [
    {
      h: '色号是什么，为什么不能混用',
      p: [
        '色号是品牌给每一种颜色起的编号。比如漫德用 A1、A2、B1 这样的字母加数字编号，COCO 用数字编号，Hama 和 Perler 各有自己的 01、02……',
        '编号本身没有含义，颜色含义在牌子里。跨品牌套用编号会拿错颜色，所以豆玩不提供「通用色号」—— 每张图纸只标一个品牌的编号。'
      ]
    },
    {
      h: '色差是怎么算的',
      p: [
        '豆玩用 CIEDE2000 色差公式在色板里找最接近的颜色。它比常见的 RGB 距离更接近人眼判断，所以「看起来是同一种颜色」在量化时会被合成同一色号。',
        '这也是为什么图纸里的颜色数通常比你预期的少：引擎会把视觉上接近的色号合并，避免出现一堆只差几颗豆的近似色。'
      ]
    },
    {
      h: '买不到某个色号怎么办',
      p: [
        '先用相近色号替代，或者在设置里把目标颜色数调低，让引擎在更少的色号里凑近似。',
        '也可以在「我的库存」里勾掉没有的颜色，生成时会自动绕开它们。'
      ]
    }
  ],
  links: [
    { href: '/', text: '免费拼豆图纸生成器' },
    { href: '/materials/', text: '免费拼豆素材库' },
    { href: '/help/', text: '拼豆教程与常见问题' }
  ]
}

/* =========================================================================
   关键词库（V3.0）
   -------------------------------------------------------------------------
   三层策略：
     1. 工具转换词   —— 有明确制作需求、准备动手做一张图纸
     2. 免费素材词   —— 想找现成拼豆图案、不打算自己上传图片
     3. 教程与专业功能词 —— 新手与进阶玩家，查色号、查做法、查功能

   同一个页面只确定**一个**主要搜索意图 + 一组自然相关词，
   禁止为近义词造出内容几乎一样的页面。
   ========================================================================= */

/** 关键词分组（三层）。 */
export const KEYWORD_GROUPS = [
  {
    key: 'tool',
    label: '工具转换词',
    desc: '有明确制作需求、准备动手做一张拼豆图纸的人。这层流量最精准，也最容易转成真实用户。'
  },
  {
    key: 'material',
    label: '免费素材词',
    desc: '想找现成拼豆图案、不打算自己上传图片的人。靠素材库和分类页接住。'
  },
  {
    key: 'tutorial',
    label: '教程与专业功能词',
    desc: '拼豆新手与进阶玩家：查色号、查做法、查分板与材料清单。长尾为主。'
  }
]

/** 搜索意图。 */
export const KEYWORD_INTENTS = [
  { key: 'tool', label: '工具使用', desc: '想立刻用工具把图片变成图纸' },
  { key: 'material', label: '找素材', desc: '想找现成的拼豆图案' },
  { key: 'info', label: '查资料', desc: '想了解色号、做法、规格' }
]

/**
 * 关键词 → 目标页面 映射。
 *
 * primary 是这个页面的**唯一**主要搜索意图；related 是同一页面上自然相关的词。
 * status 说明这个词现在有没有对应内容：
 *   planned  待建设（目标页还没内容，先补内容再优化）
 *   active   已上线
 */
export const KEYWORD_TARGETS = [
  /* ---- 第一层：工具转换词 ---- */
  {
    path: '/',
    group: 'tool',
    intent: 'tool',
    status: 'active',
    primary: '拼豆图纸生成器',
    related: ['豆玩', '拼豆图纸在线制作', '拼豆图纸制作', '拼豆图纸下载', '拼豆图纸生成']
  },
  {
    path: '/tools/photo-to-bead-pattern/',
    group: 'tool',
    intent: 'tool',
    status: 'active',
    primary: '图片转拼豆',
    related: ['照片转拼豆图纸', '图片转拼豆图纸', '照片转拼豆']
  },
  {
    path: '/tools/pixel-bead-maker/',
    group: 'tool',
    intent: 'tool',
    status: 'active',
    primary: '拼豆像素画生成器',
    related: ['像素拼豆图纸', '像素图转拼豆']
  },
  {
    path: '/tools/pet-bead-pattern/',
    group: 'tool',
    intent: 'tool',
    status: 'active',
    primary: '宠物拼豆图纸生成器',
    related: ['宠物拼豆图纸']
  },

  /* ---- 第二层：免费素材词 ---- */
  {
    path: '/materials/',
    group: 'material',
    intent: 'material',
    status: 'active',
    primary: '免费拼豆图纸',
    related: ['拼豆素材', '拼豆图纸素材', '拼豆图纸大全', '拼豆图案']
  },
  {
    path: '/materials/category/pets/',
    group: 'material',
    intent: 'material',
    status: 'active',
    primary: '动物拼豆图纸',
    related: ['萌宠拼豆图纸', '猫咪拼豆图纸', '狗狗拼豆图纸']
  },
  {
    path: '/materials/category/food/',
    group: 'material',
    intent: 'material',
    status: 'active',
    primary: '水果拼豆图纸',
    related: ['甜品拼豆图纸', '美食拼豆图纸', '蛋糕拼豆图纸']
  },
  {
    path: '/materials/category/anime/',
    group: 'material',
    intent: 'material',
    status: 'active',
    primary: '动漫拼豆图纸',
    related: ['二次元拼豆图纸', '动漫角色拼豆图纸']
  },
  {
    path: '/materials/category/festivals/',
    group: 'material',
    intent: 'material',
    status: 'planned',
    primary: '秋冬拼豆图纸',
    related: ['节日拼豆图纸', '圣诞拼豆图纸', '新年拼豆图纸']
  },
  {
    path: '/materials/category/plants/',
    group: 'material',
    intent: 'material',
    status: 'planned',
    primary: '植物拼豆图纸',
    related: ['花卉拼豆图纸']
  },
  {
    path: '/materials/category/couples/',
    group: 'material',
    intent: 'material',
    status: 'planned',
    primary: '情侣拼豆图纸',
    related: ['爱心拼豆图纸']
  },
  {
    path: '/materials/category/cute/',
    group: 'material',
    intent: 'material',
    status: 'planned',
    primary: '萌趣拼豆图纸',
    related: ['表情包拼豆图纸']
  },
  {
    path: '/materials/category/lifestyle/',
    group: 'material',
    intent: 'material',
    status: 'planned',
    primary: '生活拼豆图纸',
    related: ['杯垫拼豆图纸']
  },
  {
    path: '/materials/category/beginner/',
    group: 'material',
    intent: 'material',
    status: 'planned',
    primary: '新手拼豆图纸',
    related: ['简单拼豆图纸']
  },

  /* ---- 第三层：教程与专业功能词 ---- */
  {
    path: '/help/',
    group: 'tutorial',
    intent: 'info',
    status: 'active',
    primary: '拼豆新手教程',
    related: ['拼豆教程', '拼豆熨烫教程', '拼豆怎么拼']
  },
  {
    path: '/colors/',
    group: 'tutorial',
    intent: 'info',
    status: 'active',
    primary: '拼豆色号',
    related: ['拼豆色卡对照', '拼豆颜色匹配', '拼豆色卡']
  }
]

/**
 * 素材详情页 / 分类页的自动 SEO 模板。
 *
 * 占位符：
 *   {name}    素材名 / 分类名
 *   {category} 所属分类
 *   {count}   同分类素材数
 *   {desc}    素材自述（真实存在才有）
 *   {cols} {rows} 成品格数（真实存在才有）
 *   {tags}    标签（真实存在才有）
 *
 * descriptions 是一个**有序**的候选列表：
 * 后端按顺序取第一个「占位符全部有真实值」的那一条。
 * 这样同一个模板能生成有差异的描述（不会所有素材一模一样），
 * 同时每一条都只写真实存在的东西 —— 缺字段就不用那条。
 */
export const SEO_TEMPLATES = {
  material: {
    title: '{name}拼豆图纸｜免费拼豆素材 - 豆玩',
    h1: '{name}拼豆图纸',
    alt: '{name}拼豆图纸素材预览',
    descriptions: [
      '{desc}免费获取{name}拼豆素材，可在豆玩中在线制作拼豆图纸、匹配色号并导出，适合喜欢{category}主题拼豆的创作者。',
      '免费获取{name}拼豆素材，成品{cols}×{rows}格，可在豆玩中在线制作拼豆图纸、匹配色号并导出，适合喜欢{category}主题拼豆的创作者。',
      '免费获取{name}拼豆素材（{tags}），可在豆玩中在线制作拼豆图纸、匹配色号并导出，适合喜欢{category}主题拼豆的创作者。',
      '免费获取{name}拼豆素材，可在豆玩中在线制作拼豆图纸、匹配色号并导出，适合喜欢{category}主题拼豆的创作者。'
    ]
  },
  category: {
    title: '{name}拼豆图纸大全｜免费素材在线制作 - 豆玩',
    h1: '{name}拼豆图纸',
    alt: '{name}拼豆素材分类',
    descriptions: [
      '{desc}{name}拼豆素材全部免费，共 {count} 个，在豆玩中在线转拼豆图纸、匹配真实品牌色号并导出打印。',
      '{name}拼豆素材全部免费，共 {count} 个。在豆玩中在线转拼豆图纸、匹配真实品牌色号、统计材料用量并导出打印。'
    ]
  }
}

/**
 * 按模板填充占位符。未知占位符原样保留（宁可留着占位符，也不要写出假句子）。
 */
export function fillTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, key) => {
    const v = vars[key]
    return v === undefined || v === null || v === '' ? m : String(v)
  })
}

/**
 * 素材详情页 / 分类页的自动文案（前端兜底用）。
 *
 * 规则与后端 internal/service/seo.go 的模板填充保持一致：
 * descriptions 是一个有序候选列表，取第一条「占位符全部有真实值」的。
 * 没有真实字段就不用那条 —— 不编造素材特点、规格和功能。
 *
 * @param {{name:string, category?:string, desc?:string, cols?:number, rows?:number, tags?:string[]}} data
 * @param {'material'|'category'} kind
 */
export function autoSeoText(data, kind = 'material') {
  const tpl = SEO_TEMPLATES[kind] || SEO_TEMPLATES.material
  const vars = {
    name: (data && data.name) || '',
    category: (data && data.category) || '',
    desc: (data && data.desc) ? trimPunct(data.desc) : '',
    cols: (data && data.cols) || '',
    rows: (data && data.rows) || '',
    tags: (data && data.tags && data.tags.length) ? data.tags.slice(0, 2).join('、') : ''
  }
  let desc = ''
  for (const cand of tpl.descriptions || []) {
    // 候选句里出现的占位符必须都有真实值，否则换下一条
    const missing = [...cand.matchAll(/\{(\w+)\}/g)].some(m => vars[m[1]] === '')
    if (!missing) {
      desc = fillTemplate(cand, vars)
      break
    }
  }
  if (!desc) desc = fillTemplate((tpl.descriptions || ['']).slice(-1)[0], vars)
  return {
    title: fillTemplate(tpl.title, vars),
    description: desc,
    h1: fillTemplate(tpl.h1, vars),
    alt: fillTemplate(tpl.alt, vars)
  }
}

/** 去掉句末标点（自动生成时补句号，避免出现「。。」）。 */
function trimPunct(s) {
  return String(s || '').trim().replace(/[。．.，,；;！!？?、…\s]+$/, '')
}

/** 应用内路由清单：这些页面照常能用，但一律 noindex，也不进 Sitemap。 */
export const APP_ROUTES = [
  '/editor',
  /* 操作台 = 新手简化版的三步向导（2026-10-26 从首页挪到「创作」底下）：
     应用内页面，不参与索引，也不进 Sitemap。 */
  '/create',
  /* 首页回到 / 之后，/home 只留一个跳转（老链接），同样不进索引。 */
  '/home',
  '/projects',
  '/project-materials',
  '/build',
  '/inventory',
  '/account',
  '/auth/callback',
  '/settings',
  '/admin'
]

/** 公开可索引的静态页面（后端据此判断哪些路径是「应用内路由」）。 */
export const STATIC_PAGES = [HOME_PAGE, MATERIALS_PAGE, HELP_PAGE, COLORS_PAGE]

/**
 * 按路径找静态 SEO 页面。找不到返回 null（调用方退回路由 meta）。
 * @param {string} path 站内路径，例如 '/'、'/materials/'、'/tools/hama-bead-pattern-maker/'
 */
export function pageForPath(path) {
  const p = String(path || '/')
  if (p === '/' || p === '') return HOME_PAGE
  if (p.startsWith('/materials')) return MATERIALS_PAGE
  if (p.startsWith('/help')) return HELP_PAGE
  if (p.startsWith('/colors')) return COLORS_PAGE
  const m = p.match(/^\/tools\/([^/?#]+)/)
  if (m) {
    const tool = BUILD_TOOL_CONTENT[m[1]]
    if (tool) return toolPageMeta(tool)
  }
  return null
}

/**
 * 取某个路径的关键词目标配置（primary + related）。
 * 找不到返回 null —— 后端据此判断「这个页面还没有认领主要搜索意图」。
 */
export function keywordTargetForPath(path) {
  const p = String(path || '/')
  const hit = KEYWORD_TARGETS.find(t => t.path === p)
  if (hit) return hit
  const m = p.match(/^\/tools\/([^/?#]+)/)
  if (m) return KEYWORD_TARGETS.find(t => t.path === `/tools/${m[1]}/`) || null
  return null
}
