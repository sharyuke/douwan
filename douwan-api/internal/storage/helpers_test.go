package storage_test

import (
	"bytes"
	"encoding/base64"
	"mime/multipart"
	"net/textproto"
	"testing"
)

// newFileHeader 造一个 multipart.FileHeader，用来直接测 SaveUploaded。
//
// 必须走 multipart.Writer：multipart.FileHeader 的 Open() 依赖它内部的
// content 字段，手工 new 出来的结构体调 Open() 会 panic / 返回空。
func newFileHeader(t *testing.T, filename, contentType string, content []byte) *multipart.FileHeader {
	t.Helper()

	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	h := make(textproto.MIMEHeader)
	h.Set("Content-Disposition", `form-data; name="files"; filename="`+filename+`"`)
	h.Set("Content-Type", contentType)
	part, err := w.CreatePart(h)
	if err != nil {
		t.Fatalf("创建表单部件: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("写入表单内容: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("关闭表单: %v", err)
	}

	// 解析回来拿到 FileHeader（它的 Open 才是可用的）
	reader := multipart.NewReader(buf, w.Boundary())
	form, err := reader.ReadForm(int64(len(content)) + 4096)
	if err != nil {
		t.Fatalf("解析表单: %v", err)
	}
	if fhs := form.File["files"]; len(fhs) > 0 {
		return fhs[0]
	}
	t.Fatal("表单里没有 files 字段")
	return nil
}

// sampleWebP 是一张 2x2 的 WebP（VP8L 无损），用 base64 内联避免引入测试资源文件。
var sampleWebP = func() []byte {
	const b64 = "UklGRiIAAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA="
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		panic(err)
	}
	return raw
}()
