// Package cache 提供 Redis 客户端。Redis 是可选的：
// 未启用时相关功能回落到进程内实现。
package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"gitee.com/maryuke/douwan-api/internal/config"
)

// NewRedis 建立 Redis 客户端并做一次连通性检查。
func NewRedis(cfg config.Redis) (*redis.Client, error) {
	client := redis.NewClient(&redis.Options{
		Addr:     cfg.Addr(),
		Password: cfg.Password,
		DB:       cfg.DB,
	})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("连接 Redis: %w", err)
	}
	return client, nil
}
