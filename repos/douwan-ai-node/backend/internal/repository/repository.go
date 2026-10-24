// Package repository 是数据访问层：只做增删改查，不写业务规则。
package repository

import "gorm.io/gorm"

// Repositories 把各实体的仓储聚在一起，Service 只依赖它，
// 需要事务时用 WithTx 拿到绑定到事务的新集合。
type Repositories struct {
	db         *gorm.DB
	User       *UserRepository
	Membership *MembershipRepository
	Credit     *CreditRepository
	Usage      *UsageRepository

	// 后台管理（需求文档 MVP）
	Admin       *AdminRepository
	Plan        *PlanRepository
	CardKey     *CardKeyRepository
	Order       *OrderRepository
	Entitlement *EntitlementRepository
	Asset       *AssetRepository
	Category    *CategoryRepository
	Log         *OperationLogRepository
	Setting     *SettingRepository

	// 用户活跃数据监控
	Activity *ActivityRepository
	// 站点访问量（PV / UV，含未登录访客）
	Visit *VisitRepository

	// 本地 AI 推理任务（异步队列）与输入图登记
	AIJob    *AIJobRepository
	AIUpload *AIUploadRepository
}

// New 基于给定连接（或事务）构造仓储集合。
func New(db *gorm.DB) *Repositories {
	return &Repositories{
		db:          db,
		User:        &UserRepository{db: db},
		Membership:  &MembershipRepository{db: db},
		Credit:      &CreditRepository{db: db},
		Usage:       &UsageRepository{db: db},
		Admin:       &AdminRepository{db: db},
		Plan:        &PlanRepository{db: db},
		CardKey:     &CardKeyRepository{db: db},
		Order:       &OrderRepository{db: db},
		Entitlement: &EntitlementRepository{db: db},
		Asset:       &AssetRepository{db: db},
		Category:    &CategoryRepository{db: db},
		Log:         &OperationLogRepository{db: db},
		Setting:     &SettingRepository{db: db},
		Activity:    &ActivityRepository{db: db},
		Visit:       &VisitRepository{db: db},
		AIJob:       &AIJobRepository{db: db},
		AIUpload:    &AIUploadRepository{db: db},
	}
}

// WithTx 返回绑定到事务的仓储集合。
func (r *Repositories) WithTx(tx *gorm.DB) *Repositories { return New(tx) }
