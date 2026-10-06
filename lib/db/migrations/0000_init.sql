CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user" text NOT NULL,
	"instance_id" uuid,
	"instance_label" text,
	"company_id" text,
	"object_type" text,
	"key" text,
	"action" text NOT NULL,
	"result" text NOT NULL,
	"http_status" integer,
	"message" text,
	"request_payload" jsonb,
	"response_body" jsonb,
	"run_id" uuid
);
--> statement-breakpoint
CREATE TABLE "catalog_items" (
	"object_type" text NOT NULL,
	"key" text NOT NULL,
	"item" jsonb NOT NULL,
	"source_instance_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "catalog_items_object_type_key_pk" PRIMARY KEY("object_type","key")
);
--> statement-breakpoint
CREATE TABLE "instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"company_id" text NOT NULL,
	"company_name" text,
	"language" text DEFAULT 'es' NOT NULL,
	"environment" text DEFAULT 'production' NOT NULL,
	"auth_method" text DEFAULT 'client_credentials' NOT NULL,
	"client_id_enc" text,
	"client_secret_enc" text,
	"access_token_enc" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_enc" text,
	"is_golden" boolean DEFAULT false NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_test_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"row_index" integer NOT NULL,
	"key" text NOT NULL,
	"action" text NOT NULL,
	"diffs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"result_message" text,
	"remote_id" text,
	"executed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"source" text NOT NULL,
	"object_type" text NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"desired" jsonb NOT NULL,
	"instance_ids" jsonb NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirmed_by" text
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"instance_id" uuid NOT NULL,
	"object_type" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_items" ADD CONSTRAINT "run_items_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_instance_id_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "run_items_run_idx" ON "run_items" USING btree ("run_id","instance_id");--> statement-breakpoint
CREATE INDEX "snapshots_instance_type_idx" ON "snapshots" USING btree ("instance_id","object_type","taken_at");