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
exports.ProductAppController = void 0;
const anonymous_decorator_1 = require("../../../commons/decorator/anonymous.decorator");
const product_service_1 = require("../service/product.service");
const common_1 = require("@nestjs/common");
let ProductAppController = class ProductAppController {
    productService;
    constructor(productService) {
        this.productService = productService;
    }
    async list() {
        return [];
    }
};
exports.ProductAppController = ProductAppController;
__decorate([
    (0, anonymous_decorator_1.Anonymous)(),
    (0, common_1.Post)('/list'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ProductAppController.prototype, "list", null);
exports.ProductAppController = ProductAppController = __decorate([
    (0, common_1.Controller)('/api/product'),
    __metadata("design:paramtypes", [product_service_1.ProductService])
], ProductAppController);
//# sourceMappingURL=product.app.controller.js.map