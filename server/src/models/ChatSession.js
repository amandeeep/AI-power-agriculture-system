import mongoose from 'mongoose';
import { LANGUAGES } from '../config/constants.js';

const messageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, default: '' },
    toolCalls: { type: [mongoose.Schema.Types.Mixed], default: undefined }, // [{ name, args }]
    toolResults: { type: [mongoose.Schema.Types.Mixed], default: undefined }, // [{ name, result | error }]
    imageUrl: { type: String }, // reserved for when images are stored (e.g. object storage); not used yet
    attachment: { // photo metadata only (the image itself is not stored)
      type: new mongoose.Schema({ filename: String, mimetype: String, size: Number }, { _id: false }),
      default: undefined,
    },
    mode: { type: String, enum: ['ai', 'basic'] }, // "basic" = Gemini fallback (keyword router)
    fallbackReason: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const chatSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, default: 'New conversation', maxlength: 120 },
    language: { type: String, enum: LANGUAGES, default: 'en' },
    messages: { type: [messageSchema], default: [] },
  },
  { timestamps: true }
);

chatSessionSchema.index({ userId: 1, updatedAt: -1 });

chatSessionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const ChatSession = mongoose.model('ChatSession', chatSessionSchema);
