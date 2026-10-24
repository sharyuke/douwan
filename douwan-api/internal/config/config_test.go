package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gitee.com/maryuke/douwan-api/internal/config"
)

// writeConfig 写一份临时配置文件，返回路径。
func writeConfig(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("写配置文件: %v", err)
	}
	return path
}

func TestLoad_Defaults(t *testing.T) {
	// 指向一个不存在的路径会报错，这里用空路径 + 临时工作目录拿到纯默认值
	dir := t.TempDir()
	chdir(t, dir)

	cfg, err := config.Load("")
	if err != nil {
		t.Fatalf("加载默认配置失败: %v", err)
	}
	if cfg.Server.Port != 8080 {
		t.Fatalf("默认端口期望 8080，实际 %d", cfg.Server.Port)
	}
	if cfg.Server.Addr() != "0.0.0.0:8080" {
		t.Fatalf("监听地址不对: %q", cfg.Server.Addr())
	}
	if cfg.Database.DSN() == "" {
		t.Fatal("DSN 不应为空")
	}
	if cfg.App.IsProd() {
		t.Fatal("默认环境不应是 prod")
	}
}

func TestLoad_FromFile(t *testing.T) {
	path := writeConfig(t, `
app:
  env: prod
server:
  host: 127.0.0.1
  port: 9000
  write_timeout: 45s
database:
  host: db.internal
  name: douwan_prod
jwt:
  secret: a-real-secret
  access_ttl: 15m
admin:
  # 生产环境必须显式配置卡密加密密钥，否则服务拒绝启动
  card_cipher_key: a-real-cipher-key
`)

	cfg, err := config.Load(path)
	if err != nil {
		t.Fatalf("加载配置失败: %v", err)
	}
	if cfg.Server.Port != 9000 || cfg.Server.Host != "127.0.0.1" {
		t.Fatalf("server 未按文件生效: %+v", cfg.Server)
	}
	if cfg.Server.WriteTimeout != 45*time.Second {
		t.Fatalf("时长解析失败: %v", cfg.Server.WriteTimeout)
	}
	if cfg.Database.Name != "douwan_prod" || cfg.Database.Host != "db.internal" {
		t.Fatalf("database 未按文件生效: %+v", cfg.Database)
	}
	// 文件里没写的键应当拿到默认值，而不是零值
	if cfg.Database.Port != 5432 {
		t.Fatalf("未配置项应取默认值，实际 %d", cfg.Database.Port)
	}
	if !strings.Contains(cfg.Database.DSN(), "dbname=douwan_prod") {
		t.Fatalf("DSN 未包含库名: %s", cfg.Database.DSN())
	}
	// 后台相关默认值
	if cfg.Admin.MaxGeneratePerRequest <= 0 {
		t.Fatalf("单次生成卡密上限应有默认值，实际 %d", cfg.Admin.MaxGeneratePerRequest)
	}
	if cfg.Storage.MaxUploadBytes() != 10<<20 {
		t.Fatalf("上传上限默认应为 10MB，实际 %d", cfg.Storage.MaxUploadBytes())
	}
	if !cfg.Storage.Allows("image/png") {
		t.Fatal("默认应允许 PNG")
	}
	if cfg.Storage.Allows("image/svg+xml") {
		t.Fatal("默认不应允许 SVG（可以内嵌脚本）")
	}
}

func TestLoad_EnvOverridesFile(t *testing.T) {
	path := writeConfig(t, "server:\n  port: 9000\ndatabase:\n  password: from-file\n")

	t.Setenv("DOUWAN_SERVER_PORT", "7000")
	t.Setenv("DOUWAN_DATABASE_PASSWORD", "from-env")
	t.Setenv("DOUWAN_APP_ENV", "prod")
	t.Setenv("DOUWAN_JWT_SECRET", "env-secret")
	t.Setenv("DOUWAN_ADMIN_CARD_CIPHER_KEY", "env-cipher-key")
	t.Setenv("DOUWAN_STORAGE_UPLOAD_DIR", "/var/lib/douwan/uploads")

	cfg, err := config.Load(path)
	if err != nil {
		t.Fatalf("加载配置失败: %v", err)
	}
	if cfg.Server.Port != 7000 {
		t.Fatalf("环境变量应覆盖文件，实际端口 %d", cfg.Server.Port)
	}
	if cfg.Database.Password != "from-env" {
		t.Fatalf("环境变量应覆盖文件，实际 %q", cfg.Database.Password)
	}
	if cfg.App.Env != "prod" {
		t.Fatalf("环境变量应生效，实际 %q", cfg.App.Env)
	}
	if cfg.JWT.Secret != "env-secret" {
		t.Fatalf("密钥应来自环境变量，实际 %q", cfg.JWT.Secret)
	}
	if cfg.Admin.CardCipherKey != "env-cipher-key" {
		t.Fatalf("卡密加密密钥应来自环境变量，实际 %q", cfg.Admin.CardCipherKey)
	}
	if cfg.Storage.UploadDir != "/var/lib/douwan/uploads" {
		t.Fatalf("上传目录应来自环境变量，实际 %q", cfg.Storage.UploadDir)
	}
}

func TestLoad_Validation(t *testing.T) {
	// prodBase 是一份「除了被测项以外全部合法」的生产配置。
	// 每个用例把它和被测项拼在一起，避免因为别的校验先失败而测错方向。
	const prodBase = "app:\n  env: prod\njwt:\n  secret: real-secret\nadmin:\n  card_cipher_key: real-cipher-key\n"

	cases := []struct {
		name    string
		content string
		env     map[string]string
		want    string
	}{
		{
			// 用环境变量把密钥换成内置示例值，应该被生产环境校验拦下
			name:    "生产环境禁止使用示例密钥",
			content: prodBase,
			env:     map[string]string{"DOUWAN_JWT_SECRET": "dev-only-change-me"},
			want:    "jwt.secret",
		},
		{
			name:    "端口非法",
			content: "server:\n  port: 70000\n",
			want:    "server.port",
		},
		{
			name:    "库名为空",
			content: "database:\n  name: \"\"\n",
			want:    "database.name",
		},
		{
			name:    "刷新有效期不能短于访问有效期",
			content: "jwt:\n  access_ttl: 2h\n  refresh_ttl: 1h\n",
			want:    "jwt.refresh_ttl",
		},
		{
			name:    "卡密长度太短",
			content: "admin:\n  card_code_length: 8\n",
			want:    "admin.card_code_length",
		},
		{
			name:    "上传上限超出安全范围",
			content: "storage:\n  max_upload_mb: 500\n",
			want:    "storage.max_upload_mb",
		},
		{
			name:    "生成卡密上限非法",
			content: "admin:\n  max_generate_per_request: 0\n",
			want:    "admin.max_generate_per_request",
		},
		{
			// 生产环境必须有卡密加密密钥：没有它就无法导出交付卡密
			name:    "生产环境缺少卡密加密密钥",
			content: "app:\n  env: prod\njwt:\n  secret: real-secret\n",
			want:    "admin.card_cipher_key",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// 环境变量优先于文件：把进程里可能残留的相关变量先清掉，
			// 再用用例自己声明的变量覆盖，保证用例之间互不影响。
			for _, key := range []string{
				"DOUWAN_APP_ENV", "DOUWAN_JWT_SECRET", "DOUWAN_ADMIN_CARD_CIPHER_KEY",
				"DOUWAN_SERVER_PORT", "DOUWAN_DATABASE_NAME", "DOUWAN_STORAGE_MAX_UPLOAD_MB",
				"DOUWAN_ADMIN_CARD_CODE_LENGTH", "DOUWAN_ADMIN_MAX_GENERATE_PER_REQUEST",
			} {
				t.Setenv(key, "")
			}
			for k, v := range tc.env {
				t.Setenv(k, v)
			}

			cfg, err := config.Load(writeConfig(t, tc.content))
			if err == nil {
				t.Fatalf("应当校验失败，实际拿到 %+v", cfg)
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("错误信息应提到 %q，实际 %q", tc.want, err.Error())
			}
		})
	}
}

func TestLoad_MissingFile(t *testing.T) {
	if _, err := config.Load(filepath.Join(t.TempDir(), "nope.yaml")); err == nil {
		t.Fatal("指定了不存在的配置文件应当报错")
	}
}

// chdir 切换工作目录并在测试结束后还原。
func chdir(t *testing.T, dir string) {
	t.Helper()
	old, err := os.Getwd()
	if err != nil {
		t.Fatalf("获取工作目录: %v", err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("切换工作目录: %v", err)
	}
	t.Cleanup(func() { _ = os.Chdir(old) })
}
