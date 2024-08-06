"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntityService = void 0;
const service_exception_1 = require("../exception/service.exception");
const base_service_1 = require("./base.service");
const types_1 = require("../types");
const utils_1 = require("../utils");
class EntityService extends base_service_1.BaseService {
    repository;
    constructor(repository) {
        super();
        this.repository = repository;
    }
    getRepository() {
        return this.repository;
    }
    async findByPage(request = types_1.defaultPagination, options = {}) {
        const { page, size } = request;
        const result = await this.getRepository().findAndCount({
            skip: (page - 1) * size,
            take: size,
            ...options,
        });
        return (0, utils_1.toPage)(result[0], result[1], request);
    }
    async findById(id) {
        const options = {
            id: id || '0',
        };
        const entity = await this.getRepository().findOneBy(options);
        if (!entity) {
            throw new service_exception_1.ServiceException();
        }
        return entity;
    }
    async deleteById(id) {
        await this.getRepository().delete({
            id: id,
        });
    }
    async softDeleteById(id) {
        await this.getRepository().softDelete({
            id: id,
        });
    }
    async batchSoftDelete(query) {
        if (query?.ids?.length > 0) {
            this.repository.createQueryBuilder().whereInIds(query.ids).softDelete();
        }
    }
}
exports.EntityService = EntityService;
//# sourceMappingURL=entity.service.js.map