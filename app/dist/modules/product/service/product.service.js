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
exports.ProductService = void 0;
const entity_service_1 = require("../../../commons/service/entity.service");
const types_1 = require("../../../commons/types");
const utils_1 = require("../../../commons/utils");
const product_entity_1 = require("../domain/entity/product.entity");
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const radash_1 = require("radash");
const typeorm_2 = require("typeorm");
let ProductService = class ProductService extends entity_service_1.EntityService {
    productRepository;
    constructor(productRepository) {
        super(productRepository);
        this.productRepository = productRepository;
    }
    async checkCode(dto) {
        const count = await this.getRepository().count({
            where: {
                code: dto.code,
            },
        });
        return count <= 0;
    }
    async search(pagination = types_1.defaultPagination) {
        const { page, size } = pagination;
        const qb = this.getRepository()
            .createQueryBuilder('p')
            .take(size)
            .skip((page - 1) * size)
            .where({
            active: true,
        });
        if (!(0, radash_1.isEmpty)(pagination.q)) {
            const q = (0, utils_1.generateLike)(pagination.q);
            qb.andWhere(new typeorm_2.Brackets((qb) => {
                qb.where({ code: (0, typeorm_2.Like)(q) })
                    .orWhere({ title: (0, typeorm_2.Like)(q) })
                    .orWhere({ content: (0, typeorm_2.Like)(q) });
            }));
        }
        return qb.getManyAndCount();
    }
    async saveProduct(dto) {
        const entity = new product_entity_1.ProductEntity();
        entity.id = dto.id;
        entity.code = dto.code;
        entity.title = dto.title;
        entity.content = dto.content;
        await this.getRepository().save(entity);
    }
    toDetailsDto(entity) {
        return {
            id: entity.id,
            code: entity.code,
            title: entity.title,
            content: entity.content,
        };
    }
};
exports.ProductService = ProductService;
exports.ProductService = ProductService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(product_entity_1.ProductEntity)),
    __metadata("design:paramtypes", [Object])
], ProductService);
//# sourceMappingURL=product.service.js.map