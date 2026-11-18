// A farmer's field (plot). Soil tests and crop history hang off a field.
// `geo` is a GeoJSON point so nearby fields can be found for the "area" score.
import mongoose from 'mongoose';

const fieldSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    lat: { type: Number, min: -90, max: 90 },
    lon: { type: Number, min: -180, max: 180 },
    geo: { type: { type: String, enum: ['Point'] }, coordinates: { type: [Number], default: undefined } },
    city: { type: String, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 80 },
    district: { type: String, trim: true, maxlength: 80 },
    village: { type: String, trim: true, maxlength: 100 },
    subDistrict: { type: String, trim: true, maxlength: 100 },
    pincode: { type: String, trim: true, match: /^[1-9]\d{5}$/ },
    areaAcres: { type: Number, min: 0, max: 10000 },
  },
  { timestamps: true }
);

fieldSchema.index({ geo: '2dsphere' }, { sparse: true });

// Keep geo in sync with lat/lon.
fieldSchema.pre('save', function syncGeo() {
  if (this.lat != null && this.lon != null) this.geo = { type: 'Point', coordinates: [this.lon, this.lat] };
  else this.geo = undefined;
});

fieldSchema.set('toJSON', {
  transform: (_doc, ret) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.geo;
    return ret;
  },
});

export const Field = mongoose.model('Field', fieldSchema);
