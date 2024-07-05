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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductAdminController = void 0;
const anonymous_decorator_1 = require("../../../commons/decorator/anonymous.decorator");
const types_1 = require("../../../commons/types");
const utils_1 = require("../../../commons/utils");
const web_1 = require("../../../commons/utils/web");
const base_controller_1 = require("../../../commons/web/base.controller");
const user_list_dto_1 = require("../../core/domain/dto/user-list.dto");
const product_check_dto_1 = require("../domain/dto/product-check.dto");
const product_save_dto_1 = require("../domain/dto/product-save.dto");
const product_service_1 = require("../service/product.service");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
let ProductAdminController = class ProductAdminController extends base_controller_1.BaseController {
    productService;
    constructor(productService) {
        super();
        this.productService = productService;
    }
    async check(dto) {
        return web_1.Web.success(await this.productService.checkCode(dto));
    }
    async list(pagination) {
        const [items, total] = await this.productService.search(pagination);
        const page = (0, utils_1.toPage)(items?.map((item) => this.productService.toDetailsDto(item)), total, pagination);
        return web_1.Web.page(page);
    }
    async details(id) {
        const entity = await this.productService.findById(id);
        return web_1.Web.success(this.productService.toDetailsDto(entity));
    }
    async save(dto) {
        this.productService.saveProduct(dto).then();
        return web_1.Web.success();
    }
    async delete(dto) {
        this.productService.batchSoftDelete(dto).then();
        return web_1.Web.success();
    }
};
exports.ProductAdminController = ProductAdminController;
__decorate([
    (0, anonymous_decorator_1.Anonymous)(),
    (0, common_1.Post)('/check'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [product_check_dto_1.ProductCheckDto]),
    __metadata("design:returntype", Promise)
], ProductAdminController.prototype, "check", null);
__decorate([
    (0, anonymous_decorator_1.Anonymous)(),
    (0, swagger_1.ApiOperation)({ summary: '用户列表' }),
    (0, common_1.Post)('/list'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [user_list_dto_1.UserListDto]),
    __metadata("design:returntype", Promise)
], ProductAdminController.prototype, "list", null);
__decorate([
    (0, anonymous_decorator_1.Anonymous)(),
    (0, swagger_1.ApiOperation)({ summary: '用户详情' }),
    (0, common_1.Post)('/details'),
    __param(0, (0, common_1.Body)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], ProductAdminController.prototype, "details", null);
__decorate([
    (0, anonymous_decorator_1.Anonymous)(),
    (0, common_1.Post)('/save'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [product_save_dto_1.ProductSaveDto]),
    __metadata("design:returntype", Promise)
], ProductAdminController.prototype, "save", null);
__decorate([
    (0, anonymous_decorator_1.Anonymous)(),
    (0, common_1.Post)('/delete'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [types_1.DeleteQuery]),
    __metadata("design:returntype", Promise)
], ProductAdminController.prototype, "delete", null);
exports.ProductAdminController = ProductAdminController = __decorate([
    (0, common_1.Controller)('/api/admin/product'),
    __metadata("design:paramtypes", [product_service_1.ProductService])
], ProductAdminController);
//# sourceMappingURL=product.admin.controller.js.map