// What was grown on a field in a given season. Drives the rotation score, and (anonymously,
// aggregated) the "popular in your area" score for other farmers nearby.
import mongoose from 'mongoose';
import { SEASONS } from '../config/constants.js';

const cropHistorySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fieldId: { type: mongoose.Schema.Types.ObjectId, ref: 'Field', required: true },
    year: { type: Number, required: true, min: 1990, max: 2100 },
    season: { type: String, enum: SEASONS, required: true },
    crop: { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
    yieldQuintalPerAcre: { type: Number, min: 0, max: 1000 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

cropHistorySchema.index({ fieldId: 1, year: -1 });

cropHistorySchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const CropHistory = mongoose.model('CropHistory', cropHistorySchema);
