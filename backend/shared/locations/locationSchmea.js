const { default: mongoose } = require("mongoose");

const LocationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["Point"],
      default: "Point", // Default type is 'Point'
    },
    coordinates: {
      type: [Number],
      required: false,
      validate: {
        validator: function (arr) {
          // Only validate if coordinates are provided
          if (!arr || arr.length === 0) return true;
          return arr.length === 2;
        },
        message: "Location.coordinates must be [lng, lat]",
      },
    },
    fullAddress: {
      type: String, // Full formatted address, e.g., "13th Street 47, NY 10011, USA"
      default: "",
    },
    city: {
      type: String, // City name
      default: "",
    },
    country: {
      type: String, // Country name
      default: "",
    },
    state: {
      type: String, // State name
      default: "",
    },
    postalCode: {
      type: String, // Postal code
      default: "",
    },
  },
  { _id: false }
);

module.exports = {
  LocationSchema,
};
