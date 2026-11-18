import mongoose from 'mongoose';
import { PREDICTION_SOURCES, PREDICTION_TYPES } from '../config/constants.js';

const predictionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: PREDICTION_TYPES, required: true },
    input: { type: mongoose.Schema.Types.Mixed, required: true },
    output: { type: mongoose.Schema.Types.Mixed, required: true },
    source: { type: String, enum: PREDICTION_SOURCES, default: 'form' },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatSession' }, // set when made from chat
    // Where a crop recommendation was made (rounded to ~1 km). Used only in aggregate for nearby "area" counts.
    geo: { type: { type: String, enum: ['Point'] }, coordinates: { type: [Number], default: undefined } },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

predictionSchema.index({ userId: 1, createdAt: -1 });
predictionSchema.index({ geo: '2dsphere' }, { sparse: true });

predictionSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.geo;
    return ret;
  },
});

export const Prediction = mongoose.model('Prediction', predictionSchema);
