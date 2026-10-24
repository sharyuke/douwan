.DEFAULT_GOAL := help

BINARY_DIR := bin
SERVER_BIN := $(BINARY_DIR)/server
MIGRATE_BIN := $(BINARY_DIR)/migrate
SEED_BIN := $(BINARY_DIR)/seed

.PHONY: help
help: ## 显示所有可用命令
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

.PHONY: run
run: ## 本地启动服务（读 configs/config.yaml）
	go run ./cmd/server

.PHONY: build
build: ## 编译到 bin/
	@mkdir -p $(BINARY_DIR)
	go build -trimpath -ldflags="-s -w" -o $(SERVER_BIN) ./cmd/server
	go build -trimpath -ldflags="-s -w" -o $(MIGRATE_BIN) ./cmd/migrate
	go build -trimpath -ldflags="-s -w" -o $(SEED_BIN) ./cmd/seed

.PHONY: seed
seed: ## 初始化后台数据（草稿套餐 + 系统设置；加 -admin 才会建管理员）
	go run ./cmd/seed -config configs/config.yaml

.PHONY: seed-admin
seed-admin: ## 建首个管理员：make seed-admin ADMIN=douwan（密码读 DOUWAN_SEED_ADMIN_PASSWORD）
	@test -n "$(ADMIN)" || (echo "用法: make seed-admin ADMIN=douwan（并设置 DOUWAN_SEED_ADMIN_PASSWORD）" && exit 1)
	@test -n "$$DOUWAN_SEED_ADMIN_PASSWORD" || (echo "请先设置 DOUWAN_SEED_ADMIN_PASSWORD 环境变量" && exit 1)
	go run ./cmd/seed -config configs/config.yaml -admin $(ADMIN)

.PHONY: test
test: ## 跑全部测试（SQLite 内存库，不需要起数据库）
	go test ./...

.PHONY: test-race
test-race: ## 带竞态检测跑测试
	go test -race ./...

.PHONY: cover
cover: ## 生成覆盖率报告
	go test -coverprofile=coverage.out ./...
	go tool cover -func=coverage.out | tail -1

.PHONY: fmt
fmt: ## 格式化代码
	gofmt -w ./cmd ./internal

.PHONY: vet
vet: ## 静态检查
	go vet ./...

.PHONY: lint
lint: fmt vet ## 格式化 + 静态检查

.PHONY: tidy
tidy: ## 整理依赖
	go mod tidy

.PHONY: migrate
migrate: ## 执行数据库迁移
	go run ./cmd/migrate

.PHONY: up
up: ## 起本地依赖（PostgreSQL + Redis）
	docker compose up -d postgres redis

.PHONY: down
down: ## 停掉本地依赖
	docker compose down

.PHONY: docker-up
docker-up: ## 构建并起整套（含 API）
	docker compose up --build -d

.PHONY: docker-logs
docker-logs: ## 跟踪 API 日志
	docker compose logs -f api

.PHONY: clean
clean: ## 清理构建产物
	rm -rf $(BINARY_DIR) coverage.out
