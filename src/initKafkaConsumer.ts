import { Kafka } from "kafkajs";
import { createClient, InsertResult, DataFormat } from "@clickhouse/client";
import { v4 } from "uuid";
import { DeploymentModel, DeploymentState } from "./model/deployment.model";

/** ---------------- ClickHouse Client ---------------- **/
export interface ClickHouseClient {
    insert(options: {
        table: string;
        values: Record<string, unknown>[];
        format?: DataFormat;
    }): Promise<InsertResult>;
}

let clickhouseClient: ClickHouseClient | undefined;

export const getClickhouseClient = (): ClickHouseClient => {
    if (clickhouseClient) return clickhouseClient;

    const url = process.env.CLICKHOUSE_URL;
    const database = process.env.DATABASE;
    const username = process.env.CLICKHOUSE_USER_NAME;
    const password = process.env.CLICKHOUSE_PASSWORD;

    if (!url || !database || !username || !password) {
        throw new Error("Missing ClickHouse configuration.");
    }

    const client = createClient({ url, database, username, password });

    clickhouseClient = {
        insert: async ({ table, values, format = "JSONEachRow" }) => {
            return client.insert({ table, values, format });
        },
    };

    return clickhouseClient;
};

/** ---------------- Kafka Client ---------------- **/
export interface KafkaClient {
    consumer(options: { groupId: string }): Consumer;
}

export interface Consumer {
    connect(): Promise<void>;
    subscribe(options: { topic: string; fromBeginning: boolean }): Promise<void>;
    run(options: { eachBatch: (payload: EachBatchPayload) => Promise<void> }): Promise<void>;
}

let kafkaClientInstance: KafkaClient | undefined;

export const getKafkaClient = (): KafkaClient => {
    if (kafkaClientInstance) return kafkaClientInstance;

    const broker = process.env.KAFKA_BROKER;
    const ca = process.env.KAFKA_CA_CERTIFICATE;
    const username = process.env.KAFKA_USER_NAME;
    const password = process.env.KAFKA_PASSWORD;

    if (!broker || !ca || !username || !password) {
        throw new Error("Missing Kafka configuration.");
    }

    const kafka = new Kafka({
        clientId: "api-server",
        brokers: broker.split(","),
        ssl: { rejectUnauthorized: false, ca: ca.split("\n").filter(Boolean) },
        sasl: { mechanism: "plain", username, password },
    });

    kafkaClientInstance = {
        consumer: (options) => kafka.consumer(options),
    };

    return kafkaClientInstance;
};

/** ---------------- Kafka Types ---------------- **/
interface Message {
    value: Buffer | string | null;
    key?: Buffer | string | null;
    offset: string;
}

interface LogPayload {
    PROJECT_ID: string;
    DEPLOYMENT_ID: string;
    log: string | object;
    type?: string;
    step?: string;
    meta?: Record<string, unknown>;
}

interface DeploymentStatusPayload {
    DEPLOYMENT_ID: string;
    STATUS: string;
}

interface AnalyticsPayload {
    projectId: string;
    subDomain: string;
    ip: string;
    country: string;
    latitude?: number;
    longitude?: number;
    timestamp: string;
    referrer?: string;
    deviceType?: string;
    browser?: string;
    os?: string;
    acceptLanguage?: string;
    userAgent?: string;
    authorization?: string;
}

interface Batch {
    messages: Message[];
}

import { EachBatchPayload as KafkaEachBatchPayload } from 'kafkajs';

interface EachBatchPayload extends Omit<KafkaEachBatchPayload, 'batch'> {
    batch: Batch;
}

/** ---------------- Kafka Consumer ---------------- **/
export async function initKafkaConsumer(
    kafkaClient: KafkaClient,
    clickhouseClient: ClickHouseClient
) {
    const consumer = kafkaClient.consumer({ groupId: "api-server-logs-consumer" });

    await consumer.connect();
    await consumer.subscribe({ topic: "container-log", fromBeginning: false });
    await consumer.subscribe({ topic: "deployment-status-events", fromBeginning: false });
    await consumer.subscribe({ topic: "project-analytics", fromBeginning: false });

    await consumer.run({
        eachBatch: async ({ batch, heartbeat, commitOffsetsIfNecessary, resolveOffset }: EachBatchPayload) => {
            for (const message of batch.messages) {
                const key = message.key?.toString();
                const valueStr = message.value?.toString();
                if (!valueStr) continue;

                try {
                    if (key === "log") {
                        const payload = JSON.parse(valueStr) as LogPayload;

                        await clickhouseClient.insert({
                            table: "log_events",
                            values: [
                                {
                                    event_id: v4(),
                                    timestamp: new Date().toISOString().slice(0, 19).replace("T", " "),
                                    deployment_id: payload.DEPLOYMENT_ID,
                                    log: typeof payload.log === "string" ? payload.log : JSON.stringify(payload.log),
                                    metadata: JSON.stringify({
                                        project_id: payload.PROJECT_ID,
                                        type: payload.type || "INFO",
                                        step: payload.step || "general",
                                        ...payload.meta,
                                    }),
                                },
                            ],
                            format: "JSONEachRow",
                        });
                    } else if (key === "deployment-status") {
                        const { DEPLOYMENT_ID, STATUS } = JSON.parse(valueStr) as DeploymentStatusPayload;

                        let state = DeploymentState.QUEUED;
                        if (STATUS === "failed") state = DeploymentState.FAILED;
                        else if (STATUS === "success") state = DeploymentState.READY;
                        else if (STATUS === "in_progress") state = DeploymentState.IN_PROGRESS;

                        await DeploymentModel.findByIdAndUpdate({ _id: DEPLOYMENT_ID }, { $set: { state } });
                    } else if (key === "analytics") {
                        const payload = JSON.parse(valueStr) as AnalyticsPayload;

                        await clickhouseClient.insert({
                            table: "project_analytics",
                            values: [
                                {
                                    event_id: v4(),
                                    timestamp: new Date(payload.timestamp).toISOString().slice(0, 19).replace("T", " "),
                                    project_id: payload.projectId,
                                    sub_domain: payload.subDomain,
                                    ip: payload.ip,
                                    country: payload.country,
                                    latitude: payload.latitude,
                                    longitude: payload.longitude,
                                    referrer: payload.referrer,
                                    device_type: payload.deviceType,
                                    browser: payload.browser,
                                    os: payload.os,
                                    accept_language: payload.acceptLanguage,
                                    user_agent: payload.userAgent,
                                    authorization: payload.authorization,
                                },
                            ],
                            format: "JSONEachRow",
                        });
                    }
                    
                    await commitOffsetsIfNecessary();
                    resolveOffset(message.offset);
                    await heartbeat();
                } catch (error) {
                    console.error("Error processing message:", error);
                }
            }
        },
    });
}
