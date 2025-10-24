import { getClickhouseClient, getKafkaClient, connectMongo } from "./initClients";
import { initKafkaConsumer } from "./consumer";
import { connectDb } from "./connectDb";

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
