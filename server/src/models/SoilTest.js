// One soil test result for a field (e.g. from a Soil Health Card or a lab report).
// Values use the same scale as the crop model inputs.
import mongoose from 'mongoose';

const soilTestSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fieldId: { type: mongoose.Schema.Types.ObjectId, ref: 'Field', required: true },
    testedAt: { type: Date, required: true },
    N: { type: Number, required: true, min: 0, max: 300 },
    P: { type: Number, required: true, min: 0, max: 300 },
    K: { type: Number, required: true, min: 0, max: 400 },
    ph: { type: Number, required: true, min: 0, max: 14 },
    organicCarbon: { type: Number, min: 0, max: 10 },
    source: { type: String, enum: ['soil_health_card', 'lab', 'self'], default: 'soil_health_card' },
    note: { type: String, trim: true, maxlength: 200 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

soilTestSchema.index({ fieldId: 1, testedAt: -1 });

soilTestSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const SoilTest = mongoose.model('SoilTest', soilTestSchema);
