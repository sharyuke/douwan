// Package logger 构造基于标准库 log/slog 的日志器。
// 统一用结构化日志，方便后续直接接采集系统。
package logger

import (
	"log/slog"
	"os"
	"strings"

	"gitee.com/maryuke/douwan-api/internal/config"
)

// New 按配置构造日志器：format 决定 text / json，level 决定最低输出级别。
func New(cfg config.Log) *slog.Logger {
	opts := &slog.HandlerOptions{Level: parseLevel(cfg.Level)}

	var handler slog.Handler
	if strings.EqualFold(cfg.Format, "json") {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}
	return slog.New(handler)
}

// SetDefault 把日志器设为进程默认，让没显式持有 logger 的代码也能用 slog.Info 等。
func SetDefault(l *slog.Logger) { slog.SetDefault(l) }

func parseLevel(s string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
