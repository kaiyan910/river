-- Process Version 是不可修改的快照：執行中的 Request 依它跑到結束，資料庫層擋下 UPDATE 與 DELETE。
CREATE FUNCTION "process_versions_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'process_versions 只能新增，不能修改或刪除';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "process_versions_immutable" BEFORE UPDATE OR DELETE ON "process_versions" FOR EACH STATEMENT EXECUTE FUNCTION "process_versions_immutable"();
