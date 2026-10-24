// Package storage 负责上传图片的落盘、校验与缩略图生成。
//
// 当前只实现本地磁盘存储（需求 §8.4 允许「当前只有本地文件存储」，
// 但要求说明部署时的持久化要求）：
//   - 上传目录必须挂到持久化磁盘 / 数据卷，否则发布覆盖会丢素材；
//   - 对外 URL 由 storage.public_prefix 决定，需由 nginx 或本服务直接托管。
//
// 接口设计留出了将来换成对象存储的位置：调用方只依赖 Save 的返回值，
// 不关心文件到底落在本地还是对象存储。
package storage

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	// 必须显式注册各图片解码器：image.DecodeConfig 走的是注册表，
	// 这里少 import 一个包，对应的格式就会以「无法解析图片」被拒。
	// 线上就踩过：漏了 image/png，结果所有 PNG 上传都失败（JPEG 正常）。
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"time"

	// 注册 webp 解码器：只解不编（Go 标准库没有 webp 编码器）。
	_ "golang.org/x/image/webp"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/response"
)

// 单张图片的像素上限，防止解压炸弹（一个 100KB 的 PNG 可以解成几个 G）。
const (
	maxImagePixels = 60_000_000 // 6000 万像素
	sniffLen       = 512
)

// SavedFile 是一次成功保存的结果。
type SavedFile struct {
	// URL 对外访问地址（含 public_prefix）
	URL string
	// RelPath 相对上传根目录的路径，落库备查
	RelPath string
	// StoredName 服务端重新生成的文件名（原文件名一律丢弃，避免路径注入与冲突）
	StoredName string
	MimeType   string
	Size       int64
	Width      int
	Height     int
}

// Store 本地磁盘存储实现。
type Store struct {
	mu  sync.RWMutex
	cfg config.Storage
}

// New 构造存储。
func New(cfg config.Storage) (*Store, error) {
	if cfg.UploadDir == "" {
		return nil, errors.New("storage.upload_dir 不能为空")
	}
	if cfg.Driver != "" && cfg.Driver != "local" {
		return nil, fmt.Errorf("暂不支持的存储驱动: %s", cfg.Driver)
	}
	if err := os.MkdirAll(cfg.UploadDir, 0o755); err != nil {
		return nil, fmt.Errorf("创建上传目录 %s: %w", cfg.UploadDir, err)
	}
	return &Store{cfg: cfg}, nil
}

// Config 返回存储配置，供服务层读取上传大小上限等参数。
func (s *Store) Config() config.Storage {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cfg
}

// SetMaxUploadMB 运行期调整上传大小上限。
//
// 后台「系统设置」里改完上传限制要立刻生效，不能要求重启服务；
// 上限仍然受 config.Storage 的范围约束（1~100 MB），避免被改成一个
// 能让磁盘瞬间爆掉的值。
func (s *Store) SetMaxUploadMB(mb int) {
	if mb < 1 || mb > 100 {
		return
	}
	s.mu.Lock()
	s.cfg.MaxUploadMB = mb
	s.mu.Unlock()
}

// Root 返回上传根目录的绝对路径（供静态文件服务挂载）。
func (s *Store) Root() string {
	abs, err := filepath.Abs(s.cfg.UploadDir)
	if err != nil {
		return s.cfg.UploadDir
	}
	return abs
}

// PublicPrefix 返回对外访问前缀。
func (s *Store) PublicPrefix() string {
	p := strings.TrimSpace(s.cfg.PublicPrefix)
	if p == "" {
		p = "/uploads"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return strings.TrimRight(p, "/")
}

// subdirs 允许的业务子目录白名单：防止 category 之类的外部输入
// 变成 "../../etc" 这种路径穿越。
//
// "ai" 是本地 AI 任务的输入图与产物图（抠图 / 卡通化 / 文生图）。
// 新业务目录必须在这里登记，否则 SaveUploaded 会直接拒绝。
var subdirs = map[string]bool{
	"assets":     true,
	"thumbnails": true,
	"covers":     true,
	"ai":         true,
}

// SaveUploaded 校验并保存一个上传文件。
//
// 校验顺序刻意从便宜到昂贵：先看大小 → 嗅探真实类型 → 解码图片取尺寸，
// 这样明显不合规的文件不会走到解码那一步。
func (s *Store) SaveUploaded(fh *multipart.FileHeader, subdir string) (*SavedFile, error) {
	if fh == nil {
		return nil, response.ErrUploadRejected.WithMessage("没有收到文件")
	}
	if !subdirs[subdir] {
		return nil, response.ErrUploadRejected.WithMessage("上传目标目录不合法")
	}
	maxBytes := s.Config().MaxUploadBytes()
	if fh.Size <= 0 {
		return nil, response.ErrUploadRejected.WithMessage("文件内容为空")
	}
	if fh.Size > maxBytes {
		return nil, response.ErrUploadRejected.WithMessage(
			fmt.Sprintf("文件大小 %s 超过上限 %s", HumanSize(fh.Size), HumanSize(maxBytes)))
	}

	src, err := fh.Open()
	if err != nil {
		return nil, response.ErrUploadRejected.WithMessage("无法读取上传的文件")
	}
	defer src.Close()

	// 只读前 512 字节做类型嗅探：不信扩展名，也不信客户端声明的 Content-Type
	head := make([]byte, sniffLen)
	n, err := io.ReadFull(src, head)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return nil, response.ErrUploadRejected.WithMessage("读取文件内容失败")
	}
	head = head[:n]

	declared := fh.Header.Get("Content-Type")
	mimeType, decodeErr := DetectImageType(head, declared)
	if mimeType == "" {
		return nil, response.ErrUploadRejected.WithMessage(
			"仅支持 JPG / PNG / WEBP / GIF 图片" + detailOf(decodeErr))
	}
	if !s.Config().Allows(mimeType) {
		return nil, response.ErrUploadRejected.WithMessage("不支持的文件类型：" + mimeType)
	}

	// 回到开头，完整读一遍做真实解码校验
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return nil, response.ErrUploadRejected.WithMessage("无法重新读取上传的文件")
	}
	full, err := io.ReadAll(io.LimitReader(src, maxBytes+1))
	if err != nil {
		return nil, response.ErrUploadRejected.WithMessage("读取文件内容失败")
	}
	if int64(len(full)) > maxBytes {
		return nil, response.ErrUploadRejected.WithMessage("文件大小超过上限")
	}

	width, height, err := ImageSize(full)
	if err != nil {
		// 解码失败时把「实际收到的内容特征」打进日志：这类问题大多是
		// 客户端发来的不是图片（表单编码错误、把路径当文件发等），
		// 只看一句「不是有效图片」根本查不出来。
		slog.Warn("上传文件解码失败",
			"declared", declared,
			"sniffed", mimeType,
			"size", len(full),
			"head_hex", hex.EncodeToString(head),
			"err", err,
		)
		return nil, response.ErrUploadRejected.WithMessage("这个文件不是有效的图片（" + err.Error() + "）")
	}
	if width <= 0 || height <= 0 {
		return nil, response.ErrUploadRejected.WithMessage("图片尺寸不合法")
	}
	if width*height > maxImagePixels {
		return nil, response.ErrUploadRejected.WithMessage("图片分辨率过大，请先压缩后再上传")
	}

	storedName, err := buildStoredName(mimeType)
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	relDir := filepath.Join(subdir, time.Now().Format("2006/01"))
	absDir := filepath.Join(s.Root(), relDir)
	if err := os.MkdirAll(absDir, 0o755); err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	absPath := filepath.Join(absDir, storedName)
	if err := os.WriteFile(absPath, full, 0o644); err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}

	rel := path.Join(filepath.ToSlash(relDir), storedName)
	return &SavedFile{
		URL:        s.PublicPrefix() + "/" + rel,
		RelPath:    rel,
		StoredName: storedName,
		MimeType:   mimeType,
		Size:       int64(len(full)),
		Width:      width,
		Height:     height,
	}, nil
}

// SaveThumbnail 为已保存的原图生成缩略图。
//
// 生成失败不算致命错误：调用方会回落成「缩略图 = 原图」，
// 这样素材仍然可用，只是前台加载慢一点。
func (s *Store) SaveThumbnail(src *SavedFile, subdir string) (*SavedFile, error) {
	if src == nil {
		return nil, errors.New("缺少原图信息")
	}
	if !subdirs[subdir] {
		subdir = "thumbnails"
	}
	absSrc := filepath.Join(s.Root(), filepath.FromSlash(src.RelPath))
	raw, err := os.ReadFile(absSrc)
	if err != nil {
		return nil, err
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}

	thumb := ResizeToFit(img, s.cfg.MaxThumbSize)
	/* JPEG 没有 alpha：透明像素直接编码会变成黑底，素材卡上就是一块黑方块。
	   先铺白底再叠图，透明区域保持干净的白色。 */
	flat := image.NewRGBA(thumb.Bounds())
	draw.Draw(flat, flat.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), thumb, thumb.Bounds().Min, draw.Over)
	relDir := filepath.Join(subdir, time.Now().Format("2006/01"))
	absDir := filepath.Join(s.Root(), relDir)
	if err := os.MkdirAll(absDir, 0o755); err != nil {
		return nil, err
	}
	storedName := strings.TrimSuffix(src.StoredName, filepath.Ext(src.StoredName)) + "-thumb.jpg"
	absPath := filepath.Join(absDir, storedName)

	buf := &bytes.Buffer{}
	// 缩略图统一用 JPEG：体积小、所有浏览器都支持，不需要保留透明度
	if err := jpeg.Encode(buf, flat, &jpeg.Options{Quality: 82}); err != nil {
		return nil, err
	}
	if err := os.WriteFile(absPath, buf.Bytes(), 0o644); err != nil {
		return nil, err
	}

	rel := path.Join(filepath.ToSlash(relDir), storedName)
	b := flat.Bounds()
	return &SavedFile{
		URL:        s.PublicPrefix() + "/" + rel,
		RelPath:    rel,
		StoredName: storedName,
		MimeType:   "image/jpeg",
		Size:       int64(buf.Len()),
		Width:      b.Dx(),
		Height:     b.Dy(),
	}, nil
}

// Remove 删除一个已保存的文件（相对路径）。删不掉也不报错——
// 文件残留比「删除素材失败」更容易接受。
func (s *Store) Remove(relPath string) {
	if relPath == "" {
		return
	}
	clean := filepath.Clean(filepath.FromSlash(relPath))
	if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return
	}
	_ = os.Remove(filepath.Join(s.Root(), clean))
}

/* ------------------------------------------------------------------ 校验工具 */

// DetectImageType 判断图片真实类型。//
// 只靠 http.DetectContentType 会漏掉 WEBP（Go 标准库不识别它），
// 所以先按魔数手工判断 WEBP，再退回标准库。
// 返回的 error 只用于内部说明，不会把细节暴露给用户。
func DetectImageType(head []byte, declared string) (string, error) {
	if len(head) >= 12 && string(head[0:4]) == "RIFF" && string(head[8:12]) == "WEBP" {
		return "image/webp", nil
	}
	if len(head) >= 3 && head[0] == 0xFF && head[1] == 0xD8 && head[2] == 0xFF {
		return "image/jpeg", nil
	}
	if len(head) >= 8 && bytes.HasPrefix(head, []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A}) {
		return "image/png", nil
	}
	if len(head) >= 6 && (string(head[0:6]) == "GIF87a" || string(head[0:6]) == "GIF89a") {
		return "image/gif", nil
	}

	sniffed := http.DetectContentType(head)
	switch {
	case strings.HasPrefix(sniffed, "image/jpeg"):
		return "image/jpeg", nil
	case strings.HasPrefix(sniffed, "image/png"):
		return "image/png", nil
	case strings.HasPrefix(sniffed, "image/gif"):
		return "image/gif", nil
	}
	// SVG 要单独挡掉：它是 XML，可以内嵌脚本，直接当图片对外提供会有 XSS 风险
	if bytes.Contains(bytes.ToLower(head), []byte("<svg")) {
		return "", errors.New("暂不支持 SVG，请上传 JPG / PNG / WEBP")
	}
	return "", fmt.Errorf("识别出的类型是 %s，声明的类型是 %s", sniffed, declared)
}

// ImageSize 解码图片配置，拿到宽高。
func ImageSize(raw []byte) (int, int, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return 0, 0, errors.New("无法解析图片")
	}
	return cfg.Width, cfg.Height, nil
}

// ResizeToFit 等比缩放到长边不超过 max。原图已经足够小就原样返回。
//
// 用最近邻 + 均值降采样的简化实现：缩略图只用于列表展示，
// 追求的是「快」和「不引入第三方图像库」，不是出版级画质。
func ResizeToFit(src image.Image, max int) image.Image {
	if max <= 0 {
		max = 480
	}
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	if w <= max && h <= max {
		return src
	}
	scale := float64(max) / float64(w)
	if h > w {
		scale = float64(max) / float64(h)
	}
	nw := int(float64(w)*scale + 0.5)
	nh := int(float64(h)*scale + 0.5)
	if nw < 1 {
		nw = 1
	}
	if nh < 1 {
		nh = 1
	}

	dst := image.NewRGBA(image.Rect(0, 0, nw, nh))
	// 面积平均：把源图按目标像素划分成块，块内取平均，缩小时比最近邻干净得多
	for y := 0; y < nh; y++ {
		y0 := b.Min.Y + y*h/nh
		y1 := b.Min.Y + (y+1)*h/nh
		if y1 <= y0 {
			y1 = y0 + 1
		}
		for x := 0; x < nw; x++ {
			x0 := b.Min.X + x*w/nw
			x1 := b.Min.X + (x+1)*w/nw
			if x1 <= x0 {
				x1 = x0 + 1
			}
			var sr, sg, sb, sa, cnt uint64
			for sy := y0; sy < y1 && sy < b.Max.Y; sy++ {
				for sx := x0; sx < x1 && sx < b.Max.X; sx++ {
					r, g, bl, a := src.At(sx, sy).RGBA()
					sr += uint64(r >> 8)
					sg += uint64(g >> 8)
					sb += uint64(bl >> 8)
					sa += uint64(a >> 8)
					cnt++
				}
			}
			if cnt == 0 {
				cnt = 1
			}
			i := dst.PixOffset(x, y)
			dst.Pix[i] = uint8(sr / cnt)
			dst.Pix[i+1] = uint8(sg / cnt)
			dst.Pix[i+2] = uint8(sb / cnt)
			dst.Pix[i+3] = uint8(sa / cnt)
		}
	}
	return dst
}

// HumanSize 把字节数转成人类可读的字符串。
func HumanSize(n int64) string {
	switch {
	case n >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(n)/float64(1<<20))
	case n >= 1<<10:
		return fmt.Sprintf("%.0f KB", float64(n)/float64(1<<10))
	default:
		return fmt.Sprintf("%d B", n)
	}
}

// SaveGenerated 保存一段**服务端自己生成**的图片字节（例如本地 AI 推理产物）。
//
// 它和 SaveUploaded 的区别：
//   - 没有 multipart.FileHeader，输入是内存里的 []byte；
//   - 不套用 storage.max_upload_mb（那是**用户上传**的上限，生成产物可能有
//     几 MB，用同一个 10MB 上限会在高分辨率时误伤），改用 maxBytes 参数显式约束；
//   - 其余校验完全一致：子目录白名单 → MIME 白名单 → 真解码取尺寸 → 像素上限。
//
// 仍然**不相信调用方给的扩展名**：类型一律从字节内容嗅探（GenerateImageBytes 的
// produced 也可能是被上游篡改过的内容）。
func (s *Store) SaveGenerated(raw []byte, subdir string, maxBytes int64) (*SavedFile, error) {
	if !subdirs[subdir] {
		return nil, response.ErrUploadRejected.WithMessage("保存目标目录不合法")
	}
	if len(raw) == 0 {
		return nil, response.ErrUploadRejected.WithMessage("生成结果为空")
	}
	if maxBytes <= 0 {
		maxBytes = int64(len(raw)) + 1
	}
	if int64(len(raw)) > maxBytes {
		return nil, response.ErrUploadRejected.WithMessage(
			fmt.Sprintf("生成结果 %s 超过上限 %s", HumanSize(int64(len(raw))), HumanSize(maxBytes)))
	}
	head := raw
	if len(head) > sniffLen {
		head = head[:sniffLen]
	}
	mimeType, decodeErr := DetectImageType(head, "")
	if mimeType == "" {
		if decodeErr != nil {
			return nil, response.ErrUploadRejected.WithCause(decodeErr)
		}
		return nil, response.ErrUploadRejected.WithMessage("生成结果不是受支持的图片格式")
	}
	if !s.Config().Allows(mimeType) {
		return nil, response.ErrUploadRejected.WithMessage("不支持的图片类型：" + mimeType)
	}
	width, height, err := ImageSize(raw)
	if err != nil {
		return nil, response.ErrUploadRejected.WithMessage("无法解析生成结果的尺寸")
	}
	if width <= 0 || height <= 0 {
		return nil, response.ErrUploadRejected.WithMessage("生成结果尺寸非法")
	}
	if width*height > maxImagePixels {
		return nil, response.ErrUploadRejected.WithMessage("生成结果分辨率过大")
	}
	storedName, err := buildStoredName(mimeType)
	if err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	relDir := filepath.Join(subdir, time.Now().Format("2006/01"))
	absDir := filepath.Join(s.Root(), relDir)
	if err := os.MkdirAll(absDir, 0o755); err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	absPath := filepath.Join(absDir, storedName)
	if err := os.WriteFile(absPath, raw, 0o644); err != nil {
		return nil, response.ErrInternal.WithCause(err)
	}
	rel := path.Join(filepath.ToSlash(relDir), storedName)
	return &SavedFile{
		URL:        s.PublicPrefix() + "/" + rel,
		RelPath:    rel,
		StoredName: storedName,
		MimeType:   mimeType,
		Size:       int64(len(raw)),
		Width:      width,
		Height:     height,
	}, nil
}

// Read 按相对路径读取一个已保存的文件。用于把 AI 任务的输入图再喂给推理服务
// （不能直接用 URL 让推理节点自己去取：那需要它有出站访问我们域名的能力，
// 而推理节点在隧道另一端、只暴露了固定端口，取不到公网 URL）。
func (s *Store) Read(relPath string) ([]byte, error) {
	clean := filepath.Clean(filepath.FromSlash(relPath))
	if strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
		return nil, response.ErrUploadRejected.WithMessage("文件路径不合法")
	}
	full := filepath.Join(s.Root(), clean)
	raw, err := os.ReadFile(full)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, response.ErrNotFound.WithMessage("文件不存在或已被清理")
		}
		return nil, response.ErrInternal.WithCause(err)
	}
	return raw, nil
}

func buildStoredName(mimeType string) (string, error) {
	ext := ".bin"
	switch mimeType {
	case "image/jpeg":
		ext = ".jpg"
	case "image/png":
		ext = ".png"
	case "image/webp":
		ext = ".webp"
	case "image/gif":
		ext = ".gif"
	}
	var raw [8]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	return time.Now().Format("20060102T150405") + "-" + hex.EncodeToString(raw[:]) + ext, nil
}

func detailOf(err error) string {
	if err == nil {
		return ""
	}
	return "（" + err.Error() + "）"
}
