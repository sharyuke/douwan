// Package config 负责加载配置。
//
// 优先级：环境变量 > 配置文件 > 内置默认值。
// 环境变量统一以 DOUWAN_ 开头，层级用下划线连接，
// 例如 database.password 对应 DOUWAN_DATABASE_PASSWORD。
package config

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config 是应用的完整配置树。
type Config struct {
	App      App      `mapstructure:"app"`
	Server   Server   `mapstructure:"server"`
	Database Database `mapstructure:"database"`
	Redis    Redis    `mapstructure:"redis"`
	JWT      JWT      `mapstructure:"jwt"`
	Log      Log      `mapstructure:"log"`
	CORS     CORS     `mapstructure:"cors"`
	Admin    Admin    `mapstructure:"admin"`
	Storage  Storage  `mapstructure:"storage"`
	Activity Activity `mapstructure:"activity"`
	LocalAI  LocalAI  `mapstructure:"local_ai"`
}

// App 应用级配置。
type App struct {
	Name  string `mapstructure:"name"`
	Env   string `mapstructure:"env"`
	Debug bool   `mapstructure:"debug"`
}

// IsProd 用于决定是否启用生产环境的严格校验。
func (a App) IsProd() bool { return strings.EqualFold(a.Env, "prod") }

// Server HTTP 服务配置。
type Server struct {
	Host string `mapstructure:"host"`
	Port int    `mapstructure:"port"`
	// ShutdownTimeout 优雅关闭时等待在途请求的最长时间
	ShutdownTimeout time.Duration `mapstructure:"shutdown_timeout"`
	ReadTimeout     time.Duration `mapstructure:"read_timeout"`
	// WriteTimeout 要留足导出图纸、生成 PDF 这类慢响应
	WriteTimeout time.Duration `mapstructure:"write_timeout"`
	IdleTimeout  time.Duration `mapstructure:"idle_timeout"`
	// TrustedProxies 是允许提供 X-Forwarded-For / X-Real-IP 的反向代理地址。
	//
	// 线上只有本机 nginx 会连后端，所以默认只信回环地址。
	// 这个配置直接决定 gin 的 ClientIP() 拿到的是真实访客 IP 还是代理 IP，
	// 而活跃监控的地区统计依赖它——配错的话全站访客都会落成「内网」。
	// 不要图省事写成 0.0.0.0/0：那样任何人都能用伪造的 XFF 冒充 IP。
	TrustedProxies []string `mapstructure:"trusted_proxies"`
}

// Addr 返回 net/http 可直接使用的监听地址。
func (s Server) Addr() string { return fmt.Sprintf("%s:%d", s.Host, s.Port) }

// Database PostgreSQL 连接配置。
type Database struct {
	Host            string        `mapstructure:"host"`
	Port            int           `mapstructure:"port"`
	User            string        `mapstructure:"user"`
	Password        string        `mapstructure:"password"`
	Name            string        `mapstructure:"name"`
	SSLMode         string        `mapstructure:"sslmode"`
	TimeZone        string        `mapstructure:"timezone"`
	MaxOpenConns    int           `mapstructure:"max_open_conns"`
	MaxIdleConns    int           `mapstructure:"max_idle_conns"`
	ConnMaxLifetime time.Duration `mapstructure:"conn_max_lifetime"`
	AutoMigrate     bool          `mapstructure:"auto_migrate"`
	LogSQL          bool          `mapstructure:"log_sql"`
}

// DSN 返回 GORM postgres 驱动使用的连接串。
func (d Database) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%d user=%s password=%s dbname=%s sslmode=%s TimeZone=%s",
		d.Host, d.Port, d.User, d.Password, d.Name, d.SSLMode, d.TimeZone,
	)
}

// Redis 缓存配置。enabled 为 false 时相关功能回落到进程内实现。
type Redis struct {
	Enabled  bool   `mapstructure:"enabled"`
	Host     string `mapstructure:"host"`
	Port     int    `mapstructure:"port"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
}

// Addr 返回 Redis 地址。
func (r Redis) Addr() string { return fmt.Sprintf("%s:%d", r.Host, r.Port) }

// JWT 令牌配置。
type JWT struct {
	Secret     string        `mapstructure:"secret"`
	Issuer     string        `mapstructure:"issuer"`
	AccessTTL  time.Duration `mapstructure:"access_ttl"`
	RefreshTTL time.Duration `mapstructure:"refresh_ttl"`
}

// Log 日志配置。
type Log struct {
	Level  string `mapstructure:"level"`
	Format string `mapstructure:"format"`
}

// CORS 跨域配置。前端开发服务器默认在 5173 端口。
type CORS struct {
	AllowOrigins []string `mapstructure:"allow_origins"`
}

// Admin 后台管理相关配置。
type Admin struct {
	// CardCipherKey 卡密明文的对称加密密钥（AES-256-GCM）。
	// 生产环境必须通过 DOUWAN_ADMIN_CARD_CIPHER_KEY 注入；
	// 更换密钥会使已发出的卡密无法再解密展示（哈希校验不受影响）。
	CardCipherKey string `mapstructure:"card_cipher_key"`
	// MaxGeneratePerRequest 单次生成卡密的张数上限（防止误操作撑爆数据库）
	MaxGeneratePerRequest int `mapstructure:"max_generate_per_request"`
	// CardCodeLength 卡密随机部分长度（去掉连字符后的字符数）
	CardCodeLength int `mapstructure:"card_code_length"`
	// CardRedeemPerMinute 同一 IP 每分钟允许的卡密兑换尝试次数
	CardRedeemPerMinute int `mapstructure:"card_redeem_per_minute"`
}

// Storage 文件存储配置。当前只有本地磁盘一种实现（需求 §8.4）。
//
// 注意：本地存储要求部署时把 UploadDir 挂到持久化磁盘上，
// 否则容器重建 / 发布覆盖会丢文件。
type Storage struct {
	// Driver 目前仅支持 local
	Driver string `mapstructure:"driver"`
	// UploadDir 上传文件的落盘根目录
	UploadDir string `mapstructure:"upload_dir"`
	// PublicPrefix 对外访问前缀，前端拿到的 URL 是 PublicPrefix + "/" + 相对路径
	PublicPrefix string `mapstructure:"public_prefix"`
	// MaxUploadMB 单文件大小上限（MB）
	MaxUploadMB int `mapstructure:"max_upload_mb"`
	// MaxThumbSize 缩略图长边像素上限
	MaxThumbSize int `mapstructure:"max_thumb_size"`
	// AllowedTypes 允许的图片 MIME 类型
	AllowedTypes []string `mapstructure:"allowed_types"`
}

// MaxUploadBytes 单文件大小上限（字节）。
func (s Storage) MaxUploadBytes() int64 {
	if s.MaxUploadMB <= 0 {
		return 10 << 20
	}
	return int64(s.MaxUploadMB) << 20
}

// Allows 判断 MIME 类型是否在白名单内。白名单为空时用内置默认值。
func (s Storage) Allows(mime string) bool {
	list := s.AllowedTypes
	if len(list) == 0 {
		list = DefaultAllowedImageTypes
	}
	for _, t := range list {
		if strings.EqualFold(t, mime) {
			return true
		}
	}
	return false
}

// DefaultAllowedImageTypes 默认允许的图片类型（需求 §8.4）。
var DefaultAllowedImageTypes = []string{"image/jpeg", "image/png", "image/webp", "image/gif"}

// Activity 用户活跃数据监控配置。
//
// 采集口径：登录用户在任意前台接口上的每一次请求都会进内存缓冲，
// 由后台协程按 FlushInterval 批量汇总成「用户 × 天」一行，
// 所以它对请求路径的开销是常量级的（一次 map 累加），不写库。
type Activity struct {
	// Enabled 为 false 时完全不采样、不落库，后台接口返回空数据并在 notes 里说明。
	Enabled bool `mapstructure:"enabled"`
	// FlushInterval 内存缓冲落库的间隔。越小数据越新，写库越频繁。
	FlushInterval time.Duration `mapstructure:"flush_interval"`
	// BufferLimit 内存里最多缓存多少个「用户 × 天」桶，超过后丢弃新采样并计数。
	// 这是防雪崩的兜底：数据库挂了也不能把进程 OOM 掉。
	BufferLimit int `mapstructure:"buffer_limit"`
	// RetainDays 明细表保留天数，超期由清理协程硬删除。
	RetainDays int `mapstructure:"retain_days"`
	// CleanupInterval 清理协程的运行间隔。
	CleanupInterval time.Duration `mapstructure:"cleanup_interval"`
	// GeoEnabled 是否把 IP 解析成省市。关掉后地区维度统一显示「未知」。
	GeoEnabled bool `mapstructure:"geo_enabled"`
	// GeoV4XDB / GeoV6XDB 是 ip2region 的 xdb 数据文件路径。
	// 文件不存在时只会退化成「地区未知」，不影响服务启动。
	GeoV4XDB string `mapstructure:"geo_v4_xdb"`
	GeoV6XDB string `mapstructure:"geo_v6_xdb"`
	// GeoCachePolicy 查询器的缓存策略：buffer（全量内存，最快，约 11MB）/
	// vector（只缓存索引，内存小、每次查盘）/ none。
	GeoCachePolicy string `mapstructure:"geo_cache_policy"`
	// GeoCacheSize 进程内 IP→地区 的缓存条数（同一个 IP 只查一次库）。
	GeoCacheSize int `mapstructure:"geo_cache_size"`
	// EventReportPerMinute 同一 IP 每分钟允许的埋点上报次数（防刷）。
	EventReportPerMinute int `mapstructure:"event_report_per_minute"`
	// VisitReportPerMinute 同一 IP 每分钟允许的页面访问上报次数（防刷）。
	// 比埋点上报宽松：一次页面切换就是一条，正常用户一分钟翻十几页是常事；
	// 但也不能不设上限，否则匿名接口可以被用来灌数据。
	VisitReportPerMinute int `mapstructure:"visit_report_per_minute"`
}

// LocalAI 本地 AI 推理节点配置（ComfyUI 文生图/卡通化 + rembg 抠图）。
//
// 架构：推理跑在**内网的 Windows 节点**上（RTX 2060 6GB），通过 SSH 反向隧道
// 把它的服务映射到本机回环（例如 qq/home 上的 127.0.0.1:8188 与 127.0.0.1:7000）。
// 因此这里的地址默认就是回环地址 —— **不要**填公网地址，那意味着推理端口被暴露了。
//
// 降级行为（Enabled=false 时，也是生产环境的默认值）：
//   · 所有 /api/v1/ai/* 接口返回 40028（未开启），不建任务、不占队列、不落库；
//   · 前端「豆玩普通拼豆转换」等既有功能完全不受影响。
// 即便 Enabled=true，推理服务不可达时也只是任务失败（40033），不会影响其它接口。
type LocalAI struct {
	// Enabled 总开关。默认 false：没有显式打开开关，AI 功能一律不可用。
	Enabled bool `mapstructure:"enabled"`
	// ComfyURL / RembgURL 推理服务地址。必须是本机回环（隧道另一端），
	// 例如 http://127.0.0.1:8188 与 http://127.0.0.1:7000。
	ComfyURL string `mapstructure:"comfy_url"`
	RembgURL string `mapstructure:"rembg_url"`
	// HealthTimeout 探活（/system_stats、/api）的超时。要短，避免拖慢后台页面。
	HealthTimeout time.Duration `mapstructure:"health_timeout"`
	// SubmitTimeout 提交任务（/prompt、/upload/image、/api/remove 的上传阶段）的超时。
	SubmitTimeout time.Duration `mapstructure:"submit_timeout"`
	// JobTimeout 单个任务的**总**超时（含排队 + 推理 + 取回产物）。
	// 超过后任务置 failed 并释放队列额度，避免一条卡死的任务把队列占满。
	JobTimeout time.Duration `mapstructure:"job_timeout"`
	// PollInterval 轮询推理服务状态的间隔（ComfyUI 用 /history/{id}）。
	PollInterval time.Duration `mapstructure:"poll_interval"`
	// QueueSize 排队等待的**攒着不跑**的任务上限（不含正在跑的）。
	// 超过后新任务直接 40031，让用户稍后再试，而不是无限堆积。
	QueueSize int `mapstructure:"queue_size"`
	// MaxRunning 允许同时执行的任务数。RTX 2060 6GB 建议 1：
	// 两个 512×512 任务并发会互相挤显存，反而更慢甚至 OOM。
	MaxRunning int `mapstructure:"max_running"`
	// MaxRunningPerUser 单个用户同时执行的任务数，防止一个用户占满队列。
	MaxRunningPerUser int `mapstructure:"max_running_per_user"`
	// MaxQueuedPerUser 单个用户同时排队的任务数上限。
	MaxQueuedPerUser int `mapstructure:"max_queued_per_user"`
	// MaxUploadMB 提交给推理服务的单张图片体积上限（MB）。
	// 注意 nginx 的 client_max_body_size 是 20m，这里必须更小。
	MaxUploadMB int `mapstructure:"max_upload_mb"`
	// MaxPixels 单张图片的像素上限（宽×高）。6GB 显存下 512×512 最稳，
	// 这里给到 4M（约 2048×2048）作为硬上限，具体尺寸上限由工作流模板另外限制。
	MaxPixels int `mapstructure:"max_pixels"`
	// Checkpoint 允许使用的底模文件名（白名单）。
	// 许可约束：只有 v1-5-pruned-emaonly.ckpt（SD 1.5，CreativeML Open RAIL-M）已核验可商用，
	// 详见 docs/local-ai-models.md。留空表示不放行任何底模。
	Checkpoint string `mapstructure:"checkpoint"`
	// MattingModel 抠图模型名。**只能是 u2net**（Apache-2.0 / MIT 系）。
	// ⚠ rembg 的 /api/remove 默认模型是 bria-rmbg（商业授权），必须显式覆盖，
	// 因此本项为空或不在白名单内时，抠图功能直接不可用，而不是回落到默认模型。
	MattingModel string `mapstructure:"matting_model"`
}

// IsLoopbackURL 判断推理服务地址是否指向本机回环。
// 需求红线：推理端口不得公开暴露，所以配置里出现非回环地址时应当拒绝启动。
func IsLoopbackURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

// 内置默认值。每个键都在这里声明一次，
// 这样即使配置文件里缺项，环境变量依然能被解析出来。
func setDefaults(v *viper.Viper) {
	v.SetDefault("app.name", "douwan-api")
	v.SetDefault("app.env", "dev")
	v.SetDefault("app.debug", true)

	v.SetDefault("server.host", "0.0.0.0")
	v.SetDefault("server.port", 8080)
	v.SetDefault("server.shutdown_timeout", 10*time.Second)
	v.SetDefault("server.read_timeout", 30*time.Second)
	v.SetDefault("server.write_timeout", 2*time.Minute)
	v.SetDefault("server.idle_timeout", 2*time.Minute)
	v.SetDefault("server.trusted_proxies", []string{"127.0.0.1", "::1"})

	v.SetDefault("database.host", "127.0.0.1")
	v.SetDefault("database.port", 5432)
	v.SetDefault("database.user", "douwan")
	v.SetDefault("database.password", "douwan")
	v.SetDefault("database.name", "douwan")
	v.SetDefault("database.sslmode", "disable")
	v.SetDefault("database.timezone", "Asia/Shanghai")
	v.SetDefault("database.max_open_conns", 50)
	v.SetDefault("database.max_idle_conns", 10)
	v.SetDefault("database.conn_max_lifetime", time.Hour)
	v.SetDefault("database.auto_migrate", true)
	v.SetDefault("database.log_sql", false)

	v.SetDefault("redis.enabled", false)
	v.SetDefault("redis.host", "127.0.0.1")
	v.SetDefault("redis.port", 6379)
	v.SetDefault("redis.password", "")
	v.SetDefault("redis.db", 0)

	v.SetDefault("jwt.secret", "dev-only-change-me")
	v.SetDefault("jwt.issuer", "douwan-api")
	v.SetDefault("jwt.access_ttl", 2*time.Hour)
	v.SetDefault("jwt.refresh_ttl", 720*time.Hour)

	v.SetDefault("log.level", "info")
	v.SetDefault("log.format", "text")

	v.SetDefault("cors.allow_origins", []string{"http://localhost:5173", "http://127.0.0.1:5173"})

	v.SetDefault("admin.card_cipher_key", "")
	v.SetDefault("admin.max_generate_per_request", 1000)
	v.SetDefault("admin.card_code_length", 16)
	v.SetDefault("admin.card_redeem_per_minute", 10)

	v.SetDefault("storage.driver", "local")
	v.SetDefault("storage.upload_dir", "./data/uploads")
	v.SetDefault("storage.public_prefix", "/uploads")
	v.SetDefault("storage.max_upload_mb", 10)
	v.SetDefault("storage.max_thumb_size", 480)
	v.SetDefault("storage.allowed_types", DefaultAllowedImageTypes)

	v.SetDefault("activity.enabled", true)
	v.SetDefault("activity.flush_interval", 10*time.Second)
	v.SetDefault("activity.buffer_limit", 20000)
	v.SetDefault("activity.retain_days", 400)
	v.SetDefault("activity.cleanup_interval", 12*time.Hour)
	v.SetDefault("activity.geo_enabled", true)
	v.SetDefault("activity.geo_v4_xdb", "./data/ip2region_v4.xdb")
	v.SetDefault("activity.geo_v6_xdb", "")
	v.SetDefault("activity.geo_cache_policy", "buffer")
	v.SetDefault("activity.geo_cache_size", 8192)
	v.SetDefault("activity.event_report_per_minute", 120)
	v.SetDefault("activity.visit_report_per_minute", 240)

	// 本地 AI：默认全关。地址默认走回环（SSH 隧道另一端），不要填公网地址。
	v.SetDefault("local_ai.enabled", false)
	v.SetDefault("local_ai.comfy_url", "http://127.0.0.1:8188")
	v.SetDefault("local_ai.rembg_url", "http://127.0.0.1:7000")
	v.SetDefault("local_ai.health_timeout", 5*time.Second)
	v.SetDefault("local_ai.submit_timeout", 30*time.Second)
	v.SetDefault("local_ai.job_timeout", 10*time.Minute)
	v.SetDefault("local_ai.poll_interval", time.Second)
	v.SetDefault("local_ai.queue_size", 3)
	v.SetDefault("local_ai.max_running", 1)
	v.SetDefault("local_ai.max_running_per_user", 1)
	v.SetDefault("local_ai.max_queued_per_user", 2)
	v.SetDefault("local_ai.max_upload_mb", 10)
	v.SetDefault("local_ai.max_pixels", 4194304)
	v.SetDefault("local_ai.checkpoint", "v1-5-pruned-emaonly.ckpt")
	v.SetDefault("local_ai.matting_model", "u2net")
}

// Load 读取配置。path 为空时依次尝试 ./configs/config.yaml 与 ./config.yaml；
// 两者都不存在时只用默认值 + 环境变量，方便容器里纯靠环境变量部署。
func Load(path string) (*Config, error) {
	v := viper.New()
	v.SetEnvPrefix("DOUWAN")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()
	setDefaults(v)
	// AutomaticEnv 只对「viper 已知的键」生效，而 viper 对结构体里
	// 未在默认值里声明、也不在配置文件里出现的键（例如空字符串的
	// admin.card_cipher_key）是不知道的，环境变量会被静默忽略。
	// 这里把每个已知键显式绑定一次，保证「任何键都能用环境变量覆盖」。
	for _, key := range v.AllKeys() {
		_ = v.BindEnv(key)
	}

	if path != "" {
		v.SetConfigFile(path)
		if err := v.ReadInConfig(); err != nil {
			return nil, fmt.Errorf("读取配置文件 %s: %w", path, err)
		}
	} else {
		v.SetConfigName("config")
		v.SetConfigType("yaml")
		v.AddConfigPath("./configs")
		v.AddConfigPath(".")
		if err := v.ReadInConfig(); err != nil {
			var notFound viper.ConfigFileNotFoundError
			if !errors.As(err, &notFound) {
				return nil, fmt.Errorf("读取配置: %w", err)
			}
		}
	}

	var cfg Config
	if err := v.Unmarshal(&cfg); err != nil {
		return nil, fmt.Errorf("解析配置: %w", err)
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// Validate 校验配置是否自相矛盾。生产环境的弱密钥直接拒绝启动，
// 避免带着示例密钥上线。
func (c *Config) Validate() error {
	if c.Server.Port <= 0 || c.Server.Port > 65535 {
		return fmt.Errorf("server.port 非法: %d", c.Server.Port)
	}
	if c.Database.Name == "" {
		return fmt.Errorf("database.name 不能为空")
	}
	if c.JWT.Secret == "" {
		return fmt.Errorf("jwt.secret 不能为空")
	}
	if c.JWT.Secret == "dev-only-change-me" && c.App.IsProd() {
		return fmt.Errorf("生产环境必须通过 DOUWAN_JWT_SECRET 设置 jwt.secret")
	}
	if c.JWT.AccessTTL <= 0 || c.JWT.RefreshTTL <= 0 {
		return fmt.Errorf("jwt.access_ttl / jwt.refresh_ttl 必须为正数")
	}
	if c.JWT.RefreshTTL <= c.JWT.AccessTTL {
		return fmt.Errorf("jwt.refresh_ttl 应当大于 jwt.access_ttl")
	}
	if c.Admin.MaxGeneratePerRequest <= 0 {
		return fmt.Errorf("admin.max_generate_per_request 必须为正数")
	}
	if c.Admin.CardCodeLength < 12 {
		return fmt.Errorf("admin.card_code_length 不能小于 12，太短容易被猜")
	}
	if c.Storage.MaxUploadMB <= 0 || c.Storage.MaxUploadMB > 100 {
		return fmt.Errorf("storage.max_upload_mb 必须在 1~100 之间")
	}
	if c.Storage.UploadDir == "" {
		return fmt.Errorf("storage.upload_dir 不能为空")
	}
	// 生产环境必须显式配置卡密加密密钥：没有它就无法导出交付卡密，
	// 而用默认密钥加密等于没加密。
	if c.App.IsProd() && strings.TrimSpace(c.Admin.CardCipherKey) == "" {
		return fmt.Errorf("生产环境必须通过 DOUWAN_ADMIN_CARD_CIPHER_KEY 设置 admin.card_cipher_key")
	}
	// 活跃监控的采集参数。只做「明显不合理」的拦截：
	// flush_interval 太短会把小机器写满，buffer_limit 太小会丢数据。
	if c.Activity.Enabled {
		if c.Activity.FlushInterval < time.Second {
			return fmt.Errorf("activity.flush_interval 不能小于 1s（当前 %s）", c.Activity.FlushInterval)
		}
		if c.Activity.FlushInterval > 10*time.Minute {
			return fmt.Errorf("activity.flush_interval 不能大于 10m（当前 %s）", c.Activity.FlushInterval)
		}
		if c.Activity.BufferLimit < 100 {
			return fmt.Errorf("activity.buffer_limit 不能小于 100")
		}
		if c.Activity.RetainDays < 30 {
			return fmt.Errorf("activity.retain_days 不能小于 30（当前 %d）", c.Activity.RetainDays)
		}
		if c.Activity.GeoCacheSize < 0 {
			return fmt.Errorf("activity.geo_cache_size 不能为负数")
		}
		if c.Activity.EventReportPerMinute <= 0 {
			return fmt.Errorf("activity.event_report_per_minute 必须为正数")
		}
		if c.Activity.VisitReportPerMinute <= 0 {
			return fmt.Errorf("activity.visit_report_per_minute 必须为正数")
		}
	}
	// 本地 AI。只拦「明显不合理」与**安全红线**：
	// 推理服务必须是本机回环（隧道另一端），出现公网地址说明端口被暴露了。
	if c.LocalAI.Enabled {
		if !IsLoopbackURL(c.LocalAI.ComfyURL) {
			return fmt.Errorf("local_ai.comfy_url 必须是本机回环地址（如 http://127.0.0.1:8188），当前 %q；推理端口不得对外开放", c.LocalAI.ComfyURL)
		}
		if !IsLoopbackURL(c.LocalAI.RembgURL) {
			return fmt.Errorf("local_ai.rembg_url 必须是本机回环地址（如 http://127.0.0.1:7000），当前 %q；推理端口不得对外开放", c.LocalAI.RembgURL)
		}
		if c.LocalAI.HealthTimeout < time.Second || c.LocalAI.HealthTimeout > time.Minute {
			return fmt.Errorf("local_ai.health_timeout 应在 1s~1m 之间（当前 %s）", c.LocalAI.HealthTimeout)
		}
		if c.LocalAI.SubmitTimeout < time.Second {
			return fmt.Errorf("local_ai.submit_timeout 不能小于 1s（当前 %s）", c.LocalAI.SubmitTimeout)
		}
		if c.LocalAI.JobTimeout < 10*time.Second {
			return fmt.Errorf("local_ai.job_timeout 不能小于 10s（当前 %s）", c.LocalAI.JobTimeout)
		}
		if c.LocalAI.PollInterval < 200*time.Millisecond {
			return fmt.Errorf("local_ai.poll_interval 不能小于 200ms（当前 %s），否则会把推理服务问爆", c.LocalAI.PollInterval)
		}
		if c.LocalAI.QueueSize < 1 || c.LocalAI.QueueSize > 100 {
			return fmt.Errorf("local_ai.queue_size 应在 1~100 之间（当前 %d）", c.LocalAI.QueueSize)
		}
		if c.LocalAI.MaxRunning < 1 {
			return fmt.Errorf("local_ai.max_running 必须大于 0")
		}
		if c.LocalAI.MaxRunningPerUser < 1 {
			return fmt.Errorf("local_ai.max_running_per_user 必须大于 0")
		}
		if c.LocalAI.MaxUploadMB < 1 || c.LocalAI.MaxUploadMB > 20 {
			return fmt.Errorf("local_ai.max_upload_mb 应在 1~20 之间（当前 %d）；nginx 的 client_max_body_size 是 20m", c.LocalAI.MaxUploadMB)
		}
		if c.LocalAI.MaxPixels < 65536 {
			return fmt.Errorf("local_ai.max_pixels 太小（当前 %d）", c.LocalAI.MaxPixels)
		}
		// 模型许可红线：抠图模型必须是白名单内的（只有 u2net 完成核验）。
		// 留空或写成别的模型都直接拒绝启动，避免线上悄悄用上 bria-rmbg（商业授权）。
		if !validMattingModel(c.LocalAI.MattingModel) {
			return fmt.Errorf("local_ai.matting_model 必须是 %q（u2net 为 Apache-2.0/MIT 系，已核验可商用）；rembg 的默认模型 bria-rmbg 是商业授权模型，禁止使用", "u2net")
		}
	}
	return nil
}

// validMattingModel 抠图模型白名单。新增模型前必须先完成许可核验（docs/local-ai-models.md §7）。
func validMattingModel(name string) bool {
	switch strings.TrimSpace(name) {
	case "u2net", "u2netp", "silueta", "u2net_human_seg", "u2net_cloth_seg":
		return true
	default:
		return false
	}
}
