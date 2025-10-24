import { Kafka, EachBatchPayload } from "kafkajs";
import { v4 } from "uuid";
import { ClickHouseClient } from "@clickhouse/client";
import mongoose from "mongoose";
import { DeploymentModel, DeploymentState } from "./model/deployment.model";


export async function initKafkaConsumer(kafkaClient: Kafka, clickhouseClient: ClickHouseClient) {
    const consumer = kafkaClient.consumer({ groupId: "api-server-logs-consumer" });

    await consumer.connect();
    await consumer.subscribe({ topic: "container-log", fromBeginning: false });
    await consumer.subscribe({ topic: "deployment-status-events", fromBeginning: false });
    await consumer.subscribe({ topic: "project-analytics", fromBeginning: false });

    console.log("Kafka consumer connected and subscribed to topics");

    await consumer.run({
        eachBatch: async ({ batch, heartbeat, commitOffsetsIfNecessary, resolveOffset }: EachBatchPayload) => {
            for (const message of batch.messages) {
                const value = message.value?.toString();
                const key = message.key?.toString();
                if (!value) continue;

                try {
                    switch (key) {
                        case "log": {
                            const { PROJECT_ID, DEPLOYMENT_ID, log, type = "INFO", step = "general", meta = {} } = JSON.parse(value);
                            await clickhouseClient.insert({
                                table: "log_events",
                                values: [{ event_id: v4(), timestamp: new Date().toISOString().slice(0, 19).replace("T", " "), deployment_id: DEPLOYMENT_ID, log: typeof log === "string" ? log : JSON.stringify(log), metadata: JSON.stringify({ project_id: PROJECT_ID, type, step, ...meta }) }],
                                format: "JSONEachRow" as const
                            });
                            break;
                        }
                        case "deployment-status": {
                            const { DEPLOYMENT_ID, STATUS } = JSON.parse(value);
                            let state = DeploymentState.QUEUED;
                            if (STATUS === "failed") state = DeploymentState.FAILED;
                            else if (STATUS === "success") state = DeploymentState.READY;
                            else if (STATUS === "in_progress") state = DeploymentState.IN_PROGRESS;
                            await DeploymentModel.findByIdAndUpdate(DEPLOYMENT_ID, { state });
                            break;
                        }
                        case "analytics": {
                            const analytics = JSON.parse(value);
                            await clickhouseClient.insert({
                                table: "project_analytics",
                                values: [{
                                    event_id: v4(),
                                    timestamp: new Date(analytics.timestamp).toISOString().slice(0, 19).replace("T", " "),
                                    project_id: analytics.projectId,
                                    sub_domain: analytics.subDomain,
                                    ip: analytics.ip,
                                    country: analytics.country,
                                    latitude: analytics.latitude,
                                    longitude: analytics.longitude,
                                    referrer: analytics.referrer,
                                    device_type: analytics.deviceType,
                                    browser: analytics.browser,
                                    os: analytics.os,
                                    accept_language: analytics.acceptLanguage,
                                    user_agent: analytics.userAgent,
                                    authorization: analytics.authorization
                                }],
                                format: "JSONEachRow" as const
                            });
                            break;
                        }
                        default:
                            console.warn("Unknown Kafka key:", key);
                    }

                    resolveOffset(message.offset);
                    await commitOffsetsIfNecessary();
                    await heartbeat();
                } catch (err) {
                    console.error("Error processing message:", err);
                }
            }
        }
    });

    process.on("SIGINT", async () => {
        console.log("SIGINT received. Disconnecting consumer...");
        await consumer.disconnect();
        process.exit(0);
    });

    process.on("SIGTERM", async () => {
        console.log("SIGTERM received. Disconnecting consumer...");
        await consumer.disconnect();
        process.exit(0);
    });
}
