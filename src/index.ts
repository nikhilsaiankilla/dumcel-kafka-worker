import { getClickhouseClient, getKafkaClient } from "./initClients";
import { initKafkaConsumer } from "./consumer";
import { connectDb } from "./connectDb";
import dotenv from "dotenv";
dotenv.config();

async function main() {
    await connectDb();

    const kafkaClient = getKafkaClient();
    const clickhouseClient = getClickhouseClient();

    await initKafkaConsumer(kafkaClient, clickhouseClient);
}

main().catch(err => {
    console.error("Worker crashed:", err);
    process.exit(1);
});
