class FileService {
    /**
     *  是否可用
     */
    async available(): Promise<boolean> {
        return true;
    }
}

export default new FileService();
