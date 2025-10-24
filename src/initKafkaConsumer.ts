import { Kafka, EachBatchPayload } from "kafkajs";
import { v4 } from "uuid";
import { ClickHouseClient, createClient } from "@clickhouse/client";
import dotenv from "dotenv";
import { DeploymentModel, DeploymentState } from "./model/deployment.model";
dotenv.config();

/** ---------------- ClickHouse Client ---------------- **/
let clickhouseClient: ClickHouseClient | null = null;

export const getClickhouseClient = (): ClickHouseClient => {
    if (clickhouseClient) return clickhouseClient;

    const url = process.env.CLICKHOUSE_URL;
    const database = process.env.DATABASE;
    const username = process.env.CLICKHOUSE_USER_NAME;
    const password = process.env.CLICKHOUSE_PASSWORD;

    if (!url || !database || !username || !password) {
        throw new Error("Missing ClickHouse configuration.");
    }

    clickhouseClient = createClient({ url, database, username, password });
    return clickhouseClient;
};

/** ---------------- Kafka Client ---------------- **/
let kafka: Kafka | null = null;

export const getKafkaClient = (): Kafka => {
    if (kafka) return kafka;

    const broker = process.env.KAFKA_BROKER;
    const ca = process.env.KAFKA_CA_CERTIFICATE;
    const username = process.env.KAFKA_USER_NAME;
    const password = process.env.KAFKA_PASSWORD;

    if (!broker || !ca || !username || !password)
        throw new Error("Missing Kafka configuration.");

    kafka = new Kafka({
        clientId: "api-server",
        brokers: broker.split(","),
        ssl: { rejectUnauthorized: false, ca: ca.split("\n").filter(Boolean) },
        sasl: { mechanism: "plain", username, password },
    });

    return kafka;
};


/** ---------------- Kafka Consumer ---------------- **/
export async function initKafkaConsumer(kafkaClient: Kafka, clickhouseClient: ClickHouseClient) {
    const consumer = kafkaClient.consumer({ groupId: "api-server-logs-consumer" });

    await consumer.connect();
    await consumer.subscribe({ topic: "container-log", fromBeginning: false });
    await consumer.subscribe({ topic: "deployment-status-events", fromBeginning: false });
    await consumer.subscribe({ topic: "project-analytics", fromBeginning: false });

    await consumer.run({
        eachBatch: async ({
            batch,
            heartbeat,
            commitOffsetsIfNecessary,
            resolveOffset,
        }: EachBatchPayload) => {
            for (const message of batch.messages) {
                const value = message.value?.toString();
                const key = message.key?.toString();

                if (!value) continue;

                try {
                    if (key === "log") {
                        const { PROJECT_ID, DEPLOYMENT_ID, log, type = "INFO", step = "general", meta = {} } = JSON.parse(value);

                        await clickhouseClient.insert({
                            table: "log_events",
                            values: [
                                {
                                    event_id: v4(),
                                    timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
                                    deployment_id: DEPLOYMENT_ID,
                                    log: typeof log === "string" ? log : JSON.stringify(log),
                                    metadata: JSON.stringify({ project_id: PROJECT_ID, type, step, ...meta }),
                                },
                            ],
                            format: "JSONEachRow" as const, // 👈 type-safe
                        });
                    } else if (key === "deployment-status") {
                        const { DEPLOYMENT_ID, STATUS } = JSON.parse(value);

                        let DEPLOYMENT_STATUS = DeploymentState.QUEUED;
                        if (STATUS === "failed") DEPLOYMENT_STATUS = DeploymentState.FAILED;
                        else if (STATUS === "success") DEPLOYMENT_STATUS = DeploymentState.READY;
                        else if (STATUS === "in_progress") DEPLOYMENT_STATUS = DeploymentState.IN_PROGRESS;

                        await DeploymentModel.findByIdAndUpdate(
                            { _id: DEPLOYMENT_ID },
                            { $set: { state: DEPLOYMENT_STATUS } }
                        );
                    } else if (key === "analytics") {
                        const analytics = JSON.parse(value);

                        await clickhouseClient.insert({
                            table: "project_analytics",
                            values: [
                                {
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
                                    authorization: analytics.authorization,
                                },
                            ],
                            format: "JSONEachRow" as const,
                        });
                    }

                    resolveOffset(message.offset);
                    await commitOffsetsIfNecessary();
                    await heartbeat();
                } catch (err) {
                    console.error("Error processing message:", err);
                }
            }
        },
    });
}