<script setup>
/* AI 生成弹窗（Figma 124:1545）：描述 + 风格 + 参数 + 结果预览。
   服务端生图还没接（lib/aiPending.js），点「开始生成」只给出接入状态，不伪造结果。 */
import { computed, ref, watch } from 'vue'
import BaseDialog from '../ui/BaseDialog.vue'
import Icon from '../ui/Icon.vue'
import { AI_PENDING_TEXT } from '../../lib/aiPending.js'
import { toast } from '../../composables/useToast.js'
import { options } from '../../composables/useStudio.js'
import { PALETTE_BRANDS } from '../../lib/palettes.js'

const props = defineProps({ modelValue: { type: Boolean, default: false } })
const emit = defineEmits(['update:modelValue'])

const STYLES = ['像素萌趣', '简约轮廓', '复古像素', '自由发挥']
const SIZES = [52, 78, 104, 120]
const COLOR_CAPS = [8, 16, 24, 32]
const COUNTS = [1, 2, 4]

const prompt = ref('')
const style = ref('像素萌趣')
const size = ref(52)
const colorCap = ref(16)
const brandId = ref(options.brandId)
const count = ref(1)
const tried = ref(false)

const brands = computed(() => PALETTE_BRANDS.map(b => ({ id: b.id, name: b.name })))
const status = computed(() => `${prompt.value.trim() ? '描述已填写' : '描述为空'} · ${tried.value ? '结果尚未生成' : '结果尚未生成'}`)

watch(() => props.modelValue, v => {
  if (v) {
    tried.value = false
    brandId.value = options.brandId
  }
})

function generate() {
  tried.value = true
  toast(AI_PENDING_TEXT)
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue" title="AI 生成" head-icon="fn-ai"
    dialog-class="cmdDlg" @update:model-value="v => emit('update:modelValue', v)"
  >
    <div class="aiDlg">
      <div class="aiDlg__form">
        <div class="aiDlg__labelRow">
          <span class="cmdLabel">描述你的创作灵感</span>
          <span class="aiDlg__draft">草稿</span>
        </div>
        <div class="aiDlg__area">
          <textarea
            v-model="prompt" maxlength="500" rows="5"
            placeholder="一只趴在窗边的橘色小猫，旁边有一盆绿植。温暖柔和的配色，轮廓清晰，适合拼豆制作。"
          />
          <span class="aiDlg__count">{{ prompt.length }} / 500</span>
        </div>
        <p class="aiDlg__hint">建议包含主体、配色与构图，避免过多细节。</p>

        <p class="cmdLabel aiDlg__block">创作风格</p>
        <div class="aiDlg__chips">
          <button
            v-for="s in STYLES" :key="s" type="button"
            :class="{ on: style === s }" @click="style = s"
          >{{ s }}</button>
        </div>

        <p class="cmdLabel aiDlg__block">生成参数</p>
        <div class="aiDlg__grid">
          <label class="aiField">
            <span>图纸尺寸</span>
            <select v-model="size">
              <option v-for="n in SIZES" :key="n" :value="n">{{ n }} × {{ n }} 颗</option>
            </select>
            <Icon name="chevron-down" :size="16" />
          </label>
          <label class="aiField">
            <span>颜色上限</span>
            <select v-model="colorCap">
              <option v-for="n in COLOR_CAPS" :key="n" :value="n">{{ n }} 色</option>
            </select>
            <Icon name="chevron-down" :size="16" />
          </label>
          <label class="aiField">
            <span>品牌色板</span>
            <select v-model="brandId">
              <option v-for="b in brands" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
            <Icon name="chevron-down" :size="16" />
          </label>
          <label class="aiField">
            <span>生成数量</span>
            <select v-model="count">
              <option v-for="n in COUNTS" :key="n" :value="n">{{ n }} 张</option>
            </select>
            <Icon name="chevron-down" :size="16" />
          </label>
        </div>
      </div>

      <div class="aiDlg__side">
        <div class="aiDlg__labelRow">
          <span class="cmdLabel">结果预览</span>
          <span class="aiDlg__draft">尚未生成</span>
        </div>
        <div class="aiDlg__preview" :class="{ 'is-tried': tried }">
          <span class="aiDlg__previewIco"><Icon name="sparkles" :size="24" /></span>
          <b>{{ tried ? 'AI 生图对接中' : '让灵感变成第一张图纸' }}</b>
          <p>{{ tried ? AI_PENDING_TEXT : '描述想法并点击「开始生成」' }}</p>
          <p>{{ tried ? '接入后生成结果会显示在这里' : '生成结果将在这里显示' }}</p>
          <span class="aiDlg__previewTag">像素图纸 · 匹配品牌色板</span>
        </div>
        <div class="cmdHint">
          <Icon name="info" :size="16" />
          <span><b>先预览，再决定是否使用</b><br>生成不会自动覆盖画布。满意后，可将结果应用到当前作品。</span>
        </div>
      </div>
    </div>

    <template #footer="{ close }">
      <span class="cmdFoot__note"><span>{{ status }}</span></span>
      <div class="cmdFoot__actions">
        <button type="button" class="btn btn-secondary" @click="close">取消</button>
        <button type="button" class="btn primary" @click="generate">
          <Icon name="sparkles" :size="16" />开始生成
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<style scoped>
.aiDlg{display:grid;grid-template-columns:1fr 1fr;gap:26px}
.aiDlg__labelRow{display:flex;align-items:center;justify-content:space-between;gap:10px}
.aiDlg__labelRow .cmdLabel{margin-bottom:0}
.aiDlg__draft{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.aiDlg__area{position:relative;margin-top:8px}
.aiDlg__area textarea{
  width:100%;min-height:130px;padding:12px 14px 26px;border:1px solid var(--line);
  border-radius:12px;background:var(--surface);font:inherit;font-size:var(--fs-sm);
  line-height:var(--ty-body-lh);color:var(--ink);resize:vertical;outline:none;
}
.aiDlg__area textarea:focus{border-color:var(--primary-deep);box-shadow:0 0 0 3px var(--primary-soft)}
.aiDlg__count{position:absolute;right:12px;bottom:8px;font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.aiDlg__hint{font-size:var(--fs-xs);color:var(--muted);margin:8px 0 0;line-height:var(--ty-label-lh)}
.aiDlg__block{margin:18px 0 8px}
.aiDlg__chips{display:flex;flex-wrap:wrap;gap:8px}
.aiDlg__chips button{
  height:34px;padding:0 14px;border-radius:10px;border:1px solid var(--line);
  background:var(--surface);font-size:var(--fs-xs);font-weight:700;color:var(--ink-2);transition:var(--t);line-height:var(--ty-label-lh)
}
.aiDlg__chips button:hover{border-color:var(--line-strong)}
.aiDlg__chips button.on{background:var(--primary);border-color:var(--primary);color:var(--primary-ink)}
.aiDlg__grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.aiField{position:relative;display:flex;flex-direction:column;gap:6px}
.aiField>span{font-size:var(--fs-xs);color:var(--muted);line-height:var(--ty-label-lh)}
.aiField select{
  height:38px;padding:0 30px 0 12px;border:1px solid var(--line);border-radius:12px;
  background:var(--surface);font:inherit;font-size:var(--fs-sm);color:var(--ink);
  appearance:none;outline:none;cursor:pointer;line-height:var(--ty-body-lh)
}
.aiField select:focus{border-color:var(--primary-deep)}
.aiField .pixelIcon{position:absolute;right:10px;bottom:13px;pointer-events:none}
.aiDlg__preview{
  margin-top:8px;min-height:330px;border:1.5px dashed var(--line-strong);border-radius:14px;
  background:#FBFDF6;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:6px;padding:26px 22px;text-align:center;
}
.aiDlg__previewIco{width:52px;height:52px;border-radius:14px;background:var(--pink-soft);display:grid;place-items:center;margin-bottom:6px}
.aiDlg__preview b{font-size:var(--fs-sm);font-weight:700;color:var(--ink);line-height:var(--ty-body-lh)}
.aiDlg__preview p{font-size:var(--fs-xs);color:var(--muted);margin:0;line-height:var(--ty-label-lh)}
.aiDlg__previewTag{margin-top:12px;font-size:var(--fs-xs);color:var(--muted-2);line-height:var(--ty-label-lh)}
.aiDlg__side .cmdHint{margin-top:14px}
.aiDlg__side .cmdHint b{font-weight:700;color:var(--ink)}
@media(max-width:780px){
  .aiDlg{grid-template-columns:1fr;gap:18px}
  .aiDlg__preview{min-height:200px}
}
</style>
