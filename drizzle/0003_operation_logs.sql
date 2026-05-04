CREATE TABLE `operation_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`userOpenId` varchar(64),
	`userName` varchar(128),
	`action` varchar(32) NOT NULL,
	`resourceType` varchar(32),
	`resourceCode` varchar(64),
	`resourceName` varchar(128),
	`params` json,
	`ip` varchar(64),
	`userAgent` text,
	`success` boolean NOT NULL DEFAULT true,
	`errorMsg` text,
	`durationMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `operation_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_op_logs_user_time` ON `operation_logs` (`userId`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `idx_op_logs_action_time` ON `operation_logs` (`action`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `idx_op_logs_resource` ON `operation_logs` (`resourceCode`, `createdAt`);
