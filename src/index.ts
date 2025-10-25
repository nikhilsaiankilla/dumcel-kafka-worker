import { getClickhouseClient, getKafkaClient } from "./initClients";
import { initKafkaConsumer } from "./consumer";
import { connectDb } from "./connectDb";
import dotenv from "dotenv";
if (process.env.NODE_ENV !== "production") {
  dotenv.config(); // only load .env locally
}

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
