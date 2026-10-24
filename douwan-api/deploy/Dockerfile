# 多阶段构建：编译阶段用完整工具链，运行阶段只留二进制
FROM golang:1.26-alpine AS builder

WORKDIR /src

# 依赖单独一层，代码改动不会让依赖重新下载
COPY go.mod go.sum ./
RUN go env -w GOPROXY=https://goproxy.cn,direct && go mod download

COPY . .
# CGO_ENABLED=0 是为了拿到静态二进制，运行阶段不需要 libc
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/seed ./cmd/seed

FROM alpine:3.20

# 时区数据：图纸生成与订阅到期都按 Asia/Shanghai 判定
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 douwan

# 与 configs/config.yaml 的 database.timezone 保持一致，
# 否则容器里返回的时间戳会是 UTC，和本地跑出来的偏移不一样
ENV TZ=Asia/Shanghai

WORKDIR /app
COPY --from=builder /out/server /app/server
COPY --from=builder /out/migrate /app/migrate
COPY --from=builder /out/seed /app/seed
COPY configs /app/configs

# 素材上传目录：容器里必须挂成数据卷，否则重建容器就丢图。
# 先建好并交给 douwan 用户，避免挂载后权限不对导致上传 500。
RUN mkdir -p /app/data/uploads && chown -R douwan:douwan /app/data

USER douwan
EXPOSE 8080

# 容器内没有外部依赖时用 /healthz 做存活探针
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

ENTRYPOINT ["/app/server"]
