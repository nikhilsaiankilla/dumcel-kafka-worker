import { Kafka } from "kafkajs";
import { ClickHouseClient, createClient } from "@clickhouse/client";
import mongoose from "mongoose";

let clickhouseClient: ClickHouseClient | null = null;
export const getClickhouseClient = (): ClickHouseClient => {
    if (clickhouseClient) return clickhouseClient;

    const url = process.env.CLICKHOUSE_URL;
    const database = process.env.DATABASE;
    const username = process.env.CLICKHOUSE_USER_NAME;
    const password = process.env.CLICKHOUSE_PASSWORD;

    if (!url || !database || !username || !password)
        throw new Error("Missing ClickHouse configuration.");

    clickhouseClient = createClient({ url, database, username, password });
    return clickhouseClient;
};

let kafkaClient: Kafka | null = null;
export const getKafkaClient = (): Kafka => {
    if (kafkaClient) return kafkaClient;

    const broker = process.env.KAFKA_BROKER;
    const ca = process.env.KAFKA_CA_CERTIFICATE;
    const username = process.env.KAFKA_USER_NAME;
    const password = process.env.KAFKA_PASSWORD;

    if (!broker || !ca || !username || !password)
        throw new Error("Missing Kafka configuration.");

    kafkaClient = new Kafka({
        clientId: "api-server",
        brokers: broker.split(","),
        ssl: { rejectUnauthorized: false, ca: ca.split("\n").filter(Boolean) },
        sasl: { mechanism: "plain", username, password },
    });

    return kafkaClient;
};