"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductEntity = void 0;
const base_entity_1 = require("../../../../commons/entity/base.entity");
const typeorm_1 = require("typeorm");
let ProductEntity = class ProductEntity extends base_entity_1.BaseEntity {
    code;
    title;
    content;
    description;
    idx;
    startDatetime;
    endDatetime;
    status;
};
exports.ProductEntity = ProductEntity;
__decorate([
    (0, typeorm_1.Column)({ name: 'code', comment: '编号' }),
    __metadata("design:type", String)
], ProductEntity.prototype, "code", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'title', comment: '标题' }),
    __metadata("design:type", String)
], ProductEntity.prototype, "title", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'content', comment: '内容' }),
    __metadata("design:type", String)
], ProductEntity.prototype, "content", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'description', comment: '备注' }),
    __metadata("design:type", String)
], ProductEntity.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'idx', comment: '序号' }),
    __metadata("design:type", Number)
], ProductEntity.prototype, "idx", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'start_datetime', comment: '发布开始日期' }),
    __metadata("design:type", Date)
], ProductEntity.prototype, "startDatetime", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'end_datetime', comment: '发布结束日期' }),
    __metadata("design:type", Date)
], ProductEntity.prototype, "endDatetime", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'status', comment: '状态' }),
    __metadata("design:type", Number)
], ProductEntity.prototype, "status", void 0);
exports.ProductEntity = ProductEntity = __decorate([
    (0, typeorm_1.Entity)('sys_product')
], ProductEntity);
//# sourceMappingURL=product.entity.js.map