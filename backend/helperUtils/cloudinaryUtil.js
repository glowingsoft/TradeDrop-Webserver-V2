require("dotenv").config();
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadToCloudinary = async (file, folder = "td") => {
  try {
    if (!file || !file.buffer) {
      throw new Error("File is required for upload");
    }
    const result = await new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: folder,
          resource_type: "auto",
        },
        (error, result) => {
          if (error) return reject(error);
          resolve(result);
        },
      );

      uploadStream.end(file.buffer);
    });
    return {
      file: `v${result.version}/${result.public_id}.${result.format}`,
      fileUrl: result.secure_url,
      publicId: result.public_id,
    };
  } catch (error) {
    throw error;
  }
};
const deleteFromCloudinary = async (path) => {
  try {
    const publicId = getPublicId(path);
    if (!publicId) {
      throw new Error("Public ID is required for deletion");
    }
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    throw error;
  }
};
const getPublicId = (path) => {
  return path.replace(/^v\d+\//, "").replace(/\.[^.]+$/, "");
};

module.exports = { uploadToCloudinary, deleteFromCloudinary, getPublicId };
