package model

import (
	"strings"
	"testing"
)

func TestNormalizeVisitPath(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{name: "路由模板原样保留", raw: "/library/:slug", want: "/library/:slug"},
		{name: "砍掉查询串与哈希", raw: "/editor?tab=ai&x=1#top", want: "/editor"},
		{name: "折叠重复斜杠并去掉结尾斜杠", raw: "/a//b//", want: "/a/b"},
		{name: "根路径保持根路径", raw: "/", want: "/"},
		{name: "不以斜杠开头的一律归到 other", raw: "editor", want: VisitorUnknownPath},
		{name: "带括号的可疑路径归到 other", raw: "/a(1)", want: VisitorUnknownPath},
		{name: "带空格与中文的路径归到 other", raw: "/素材 详情", want: VisitorUnknownPath},
		{name: "空串归到 other", raw: "   ", want: VisitorUnknownPath},
		{name: "超长路径被截断到列宽", raw: "/" + strings.Repeat("x", 200), want: "/" + strings.Repeat("x", VisitorPathMaxLength-1)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := NormalizeVisitPath(tc.raw)
			if got != tc.want {
				t.Fatalf("NormalizeVisitPath(%q) = %q，期望 %q", tc.raw, got, tc.want)
			}
			if len(got) > VisitorPathMaxLength {
				t.Fatalf("归一化后的路径超过列宽 %d: %q", VisitorPathMaxLength, got)
			}
		})
	}
}

func TestVisitorID(t *testing.T) {
	id := NewVisitorID()
	if !IsVisitorID(id) {
		t.Fatalf("生成的访客标识不合法: %q", id)
	}
	if len(id) != VisitorIDBytes*2 {
		t.Fatalf("访客标识长度 = %d，期望 %d", len(id), VisitorIDBytes*2)
	}
	if NewVisitorID() == id {
		t.Fatal("两次生成的访客标识不应该相同")
	}
	if IsVisitorID(strings.ToUpper(id)) {
		t.Fatal("大写十六进制不应通过校验（列宽与比较都是小写口径）")
	}
	if IsVisitorID(id[:len(id)-1]) || IsVisitorID("") || IsVisitorID(strings.Repeat("z", 32)) {
		t.Fatal("长度不对或含非法字符的标识不应通过校验")
	}
}

func TestMaskVisitor(t *testing.T) {
	full := strings.Repeat("a", 16) + strings.Repeat("b", 16)
	got := MaskVisitor(full)
	if got == full {
		t.Fatal("脱敏后不应返回完整标识")
	}
	if !strings.HasPrefix(got, strings.Repeat("a", 8)) {
		t.Fatalf("脱敏结果应保留前 8 位: %q", got)
	}
	if MaskVisitor("short") != "short" {
		t.Fatal("短标识原样返回，不做越界截取")
	}
}
