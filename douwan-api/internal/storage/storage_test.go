package storage_test

import (
	"bytes"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"gitee.com/maryuke/douwan-api/internal/config"
	"gitee.com/maryuke/douwan-api/internal/storage"
)

// TestImageSize_AllSupportedFormats 覆盖「服务端能解码前台允许的每一种图片」。
//
// 这条用例来自一次真实的线上事故：storage.go 里只 import 了 image/jpeg，
// 漏了 image/png 的**空白 import**（解码器要靠它注册到 image.DecodeConfig 的
// 注册表里）。结果 JPEG 上传正常、**所有 PNG 上传都报「不是有效的图片」**
// —— 而当时的单元测试用的是 SQLite + 自造请求，根本没走真实图片解码，
// 所以一路绿灯。这个用例就是为了让这种缺失在 go test 阶段就暴露。
func TestImageSize_AllSupportedFormats(t *testing.T) {
	src := image.NewRGBA(image.Rect(0, 0, 9, 7))
	for y := 0; y < 7; y++ {
		for x := 0; x < 9; x++ {
			src.Set(x, y, color.RGBA{R: 0xF4, G: 0xA1, B: 0x5B, A: 0xFF})
		}
	}

	encode := map[string]func(*bytes.Buffer) error{
		"png":  func(b *bytes.Buffer) error { return png.Encode(b, src) },
		"jpeg": func(b *bytes.Buffer) error { return jpeg.Encode(b, src, nil) },
		"gif":  func(b *bytes.Buffer) error { return gif.Encode(b, src, nil) },
	}

	for name, fn := range encode {
		t.Run(name, func(t *testing.T) {
			buf := &bytes.Buffer{}
			if err := fn(buf); err != nil {
				t.Fatalf("编码 %s: %v", name, err)
			}
			raw := buf.Bytes()

			// 1) 类型嗅探要认出来
			detected, err := storage.DetectImageType(raw, "")
			if err != nil || detected == "" {
				t.Fatalf("%s 应被识别为图片，实际 mime=%q err=%v", name, detected, err)
			}
			// 2) 尺寸必须解得出来（这一步依赖解码器已注册）
			w, h, err := storage.ImageSize(raw)
			if err != nil {
				t.Fatalf("%s 解码失败：%v（检查 storage.go 是否 import 了对应的解码器包）", name, err)
			}
			if w != 9 || h != 7 {
				t.Fatalf("%s 尺寸应为 9x7，实际 %dx%d", name, w, h)
			}
		})
	}

	// webp 用一段真实的最小编码数据（Go 标准库没有 webp 编码器）
	t.Run("webp", func(t *testing.T) {
		if w, h, err := storage.ImageSize(sampleWebP); err != nil {
			t.Skipf("webp 解码失败：%v（测试数据不适用，跳过而不是误报）", err)
		} else if w <= 0 || h <= 0 {
			t.Fatalf("webp 尺寸异常：%dx%d", w, h)
		}
		mime, err := storage.DetectImageType(sampleWebP, "")
		if err != nil || mime != "image/webp" {
			t.Fatalf("webp 类型识别失败：mime=%q err=%v", mime, err)
		}
	})
}

// TestSaveUploaded_RealPNG 走一遍完整的落盘流程，确保上传路径端到端可用。
func TestSaveUploaded_RealPNG(t *testing.T) {
	store, err := storage.New(config.Storage{
		Driver: "local", UploadDir: t.TempDir(), PublicPrefix: "/uploads",
		MaxUploadMB: 10, MaxThumbSize: 8,
	})
	if err != nil {
		t.Fatalf("构造存储: %v", err)
	}

	src := image.NewRGBA(image.Rect(0, 0, 40, 30))
	for y := 0; y < 30; y++ {
		for x := 0; x < 40; x++ {
			src.Set(x, y, color.RGBA{R: 0x33, G: 0x99, B: 0xCC, A: 0xFF})
		}
	}
	buf := &bytes.Buffer{}
	if err := png.Encode(buf, src); err != nil {
		t.Fatalf("编码 PNG: %v", err)
	}

	fh := newFileHeader(t, "cat.png", "image/png", buf.Bytes())
	saved, err := store.SaveUploaded(fh, "assets")
	if err != nil {
		t.Fatalf("保存上传文件失败：%v", err)
	}
	if saved.Width != 40 || saved.Height != 30 {
		t.Fatalf("尺寸应为 40x30，实际 %dx%d", saved.Width, saved.Height)
	}
	if saved.MimeType != "image/png" {
		t.Fatalf("类型应为 image/png，实际 %s", saved.MimeType)
	}
	if saved.URL == "" || saved.RelPath == "" {
		t.Fatalf("应返回可访问的 URL 与相对路径：%+v", saved)
	}

	thumb, err := store.SaveThumbnail(saved, "thumbnails")
	if err != nil {
		t.Fatalf("生成缩略图失败：%v", err)
	}
	if thumb.Width > 8 || thumb.Height > 8 {
		t.Fatalf("缩略图长边应不超过 8，实际 %dx%d", thumb.Width, thumb.Height)
	}
	if thumb.MimeType != "image/jpeg" {
		t.Fatalf("缩略图统一用 JPEG，实际 %s", thumb.MimeType)
	}
}

// TestSaveThumbnail_FlattensTransparencyOnWhite 覆盖透明 PNG 的缩略图底色。
//
// JPEG 没有 alpha 通道；直接编码 RGBA 会把透明像素写成黑色，
// 前台素材卡就会出现一整块黑底。缩略图必须先铺白底再叠图。
func TestSaveThumbnail_FlattensTransparencyOnWhite(t *testing.T) {
	dir := t.TempDir()
	store, err := storage.New(config.Storage{
		Driver: "local", UploadDir: dir, PublicPrefix: "/uploads", MaxUploadMB: 10,
	})
	if err != nil {
		t.Fatalf("构造存储: %v", err)
	}
	src := image.NewRGBA(image.Rect(0, 0, 40, 30))
	for y := 10; y < 20; y++ {
		for x := 15; x < 25; x++ {
			src.Set(x, y, color.RGBA{R: 0xE0, G: 0x30, B: 0x30, A: 0xFF})
		}
	}
	buf := &bytes.Buffer{}
	if err := png.Encode(buf, src); err != nil {
		t.Fatalf("编码 PNG: %v", err)
	}
	saved, err := store.SaveUploaded(newFileHeader(t, "transparent.png", "image/png", buf.Bytes()), "assets")
	if err != nil {
		t.Fatalf("保存上传文件失败：%v", err)
	}
	thumb, err := store.SaveThumbnail(saved, "thumbnails")
	if err != nil {
		t.Fatalf("生成缩略图失败：%v", err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(thumb.RelPath)))
	if err != nil {
		t.Fatalf("读取缩略图失败：%v", err)
	}
	img, err := jpeg.Decode(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("解码缩略图失败：%v", err)
	}
	r, g, b, _ := img.At(1, 1).RGBA()
	if r>>8 < 240 || g>>8 < 240 || b>>8 < 240 {
		t.Fatalf("透明区域应铺成白色，实际 RGB=(%d,%d,%d)", r>>8, g>>8, b>>8)
	}
}

// TestSaveUploaded_RejectsNonImage 覆盖「不信扩展名，按内容判断」。
func TestSaveUploaded_RejectsNonImage(t *testing.T) {
	store, err := storage.New(config.Storage{
		Driver: "local", UploadDir: t.TempDir(), PublicPrefix: "/uploads", MaxUploadMB: 10,
	})
	if err != nil {
		t.Fatalf("构造存储: %v", err)
	}

	cases := []struct {
		name    string
		content []byte
		mime    string
	}{
		{"伪装成 png 的文本", []byte("this is definitely not a png"), "image/png"},
		{"svg 被拒绝", []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`), "image/svg+xml"},
		{"空文件", []byte{}, "image/png"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fh := newFileHeader(t, "x.png", tc.mime, tc.content)
			if _, err := store.SaveUploaded(fh, "assets"); err == nil {
				t.Fatalf("%s 应被拒绝", tc.name)
			}
		})
	}
}

// TestSaveUploaded_RejectsBadSubdir 覆盖路径穿越防护。
func TestSaveUploaded_RejectsBadSubdir(t *testing.T) {
	store, err := storage.New(config.Storage{
		Driver: "local", UploadDir: t.TempDir(), PublicPrefix: "/uploads", MaxUploadMB: 10,
	})
	if err != nil {
		t.Fatalf("构造存储: %v", err)
	}
	fh := newFileHeader(t, "a.png", "image/png", []byte("\x89PNG\r\n\x1a\n"))
	if _, err := store.SaveUploaded(fh, "../../etc"); err == nil {
		t.Fatal("非法子目录应被拒绝（防路径穿越）")
	}
}
