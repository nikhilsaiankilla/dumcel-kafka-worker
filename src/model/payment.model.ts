import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICreditPurchase extends Document {
    userId: mongoose.Types.ObjectId;
    amount: number; // total INR amount paid
    credits: number; // credits granted for that payment
    orderId: string; // Razorpay order ID
    paymentId?: string; // Razorpay payment ID (after success)
    status: "created" | "paid" | "failed";
    currency: string;
    createdAt: Date;
    updatedAt: Date;
}

const CreditPurchaseSchema: Schema<ICreditPurchase> = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: "User",
    },
    amount: {
        type: Number,
        required: true,
    },
    credits: {
        type: Number,
        required: true,
    },
    orderId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
    },
    paymentId: {
        type: String,
        required: false,
        trim: true,
    },
    status: {
        type: String,
        enum: ["created", "paid", "failed"],
        default: "created",
    },
    currency: {
        type: String,
        default: "INR",
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    updatedAt: {
        type: Date,
        default: Date.now,
    },
});

// Automatically update updatedAt
CreditPurchaseSchema.pre("save", function (next) {
    this.updatedAt = new Date();
    next();
});

export const CreditPurchaseModel: Model<ICreditPurchase> = mongoose.model<ICreditPurchase>(
    "CreditPurchase",
    CreditPurchaseSchema
);
