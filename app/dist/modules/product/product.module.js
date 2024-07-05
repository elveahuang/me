"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProductModule = void 0;
const commons_module_1 = require("../../commons/commons.module");
const utils_1 = require("../../commons/utils");
const auth_module_1 = require("../auth/auth.module");
const core_module_1 = require("../core/core.module");
const product_admin_controller_1 = require("./controller/product.admin.controller");
const product_app_controller_1 = require("./controller/product.app.controller");
const product_entity_1 = require("./domain/entity/product.entity");
const product_repository_1 = require("./repository/product.repository");
const product_service_1 = require("./service/product.service");
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
let ProductModule = class ProductModule {
};
exports.ProductModule = ProductModule;
exports.ProductModule = ProductModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([product_entity_1.ProductEntity]), commons_module_1.CommonsModule, core_module_1.CoreModule, auth_module_1.AuthModule],
        providers: [(0, utils_1.createCustomRepository)(product_entity_1.ProductEntity, product_repository_1.ProductRepositoryImpl), product_service_1.ProductService],
        controllers: [product_admin_controller_1.ProductAdminController, product_app_controller_1.ProductAppController],
        exports: [product_service_1.ProductService],
    })
], ProductModule);
//# sourceMappingURL=product.module.js.map