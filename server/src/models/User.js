import mongoose from 'mongoose';
import { LANGUAGES } from '../config/constants.js';

const locationSchema = new mongoose.Schema(
  {
    lat: { type: Number, min: -90, max: 90 },
    lon: { type: Number, min: -180, max: 180 },
    city: { type: String, trim: true, maxlength: 100 }, // display label
    village: { type: String, trim: true, maxlength: 100 },
    subDistrict: { type: String, trim: true, maxlength: 100 },
    district: { type: String, trim: true, maxlength: 80 },
    state: { type: String, trim: true, maxlength: 80 },
    pincode: { type: String, trim: true, match: /^[1-9]\d{5}$/ },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // A user signs up with an email, a phone number, or both. Sparse unique indexes allow either to be missing.
    email: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    phone: { type: String, trim: true, unique: true, sparse: true },
    passwordHash: { type: String, required: true, select: false },
    preferredLanguage: { type: String, enum: LANGUAGES, default: 'en' },
    location: { type: locationSchema, default: undefined },
  },
  { timestamps: true }
);

// Never leak the hash (or Mongo internals) in API responses.
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    return ret;
  },
});

export const User = mongoose.model('User', userSchema);
