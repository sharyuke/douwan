package model

// 自己标注的两种方式。
//
// user 是前台账号 ID；visitor 是浏览器访客标识（32 位，或列表里能看到的前 8 位）。
// 标上之后统计仍然把这些人算进总数，只是单独报出「其中自己」。
const (
	SelfKindUser    = "user"
	SelfKindVisitor = "visitor"
)

// ActivitySelfMark 是后台「用户数据」里标成自己的一条记录。
//
// 站点主人自己注册、登录、打开页面会产生大量数字。这些数字要留在总数里，
// 同时能认出来，所以单独记一份名单，而不是从统计里扣掉。
type ActivitySelfMark struct {
	Base
	Kind  string `gorm:"size:16;uniqueIndex:uk_activity_self;not null" json:"kind"`
	Value string `gorm:"size:64;uniqueIndex:uk_activity_self;not null" json:"value"`
	Label string `gorm:"size:64" json:"label"`
}

// TableName 固定表名。
func (ActivitySelfMark) TableName() string { return "activity_self_marks" }
