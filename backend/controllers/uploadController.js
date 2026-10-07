const fs = require("fs").promises;
const path = require("path");
const mime = require("mime-types");

const { upload, uploadToMemory } = require("../middlewares/uploadFileMw");
const { sendResponse } = require("../helperUtils/responseUtil");
const { uploadToCloudinary, deleteFromCloudinary } = require("@helperUtils/cloudinaryUtil");

const getFileType = (mimeType = "") => {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return "document";
};

/**
 * Upload File
 */
const uploadFile = (req, res) => {
  uploadToMemory(req, res, async (err) => {
    try {
      if (err) {
        return sendResponse({
          res,
          statusCode: 400,
          translationKey: "file_upload_1",
          error: err.message || err,
        });
      }

      if (!req.file) {
        return sendResponse({
          res,
          statusCode: 400,
          translationKey: "no_file",
        });
      }

      const result = await uploadToCloudinary(req.file, "td");

      return sendResponse({
        res,
        statusCode: 200,
        translationKey: "file_uploaded",
        data: {
          message: "File uploaded successfully!",
          file: result.file,
          fileUrl: result.fileUrl,
        },
      });
    } catch (error) {
      console.error("Upload File Error:", error);

      return sendResponse({
        res,
        statusCode: 500,
        translationKey: "something_went_wrong",
        error: error.message,
      });
    }
  });
};

/**
 * Get File
 */
const getFileByName = async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, "../uploads", filename);

    await fs.access(filePath);

    return res.sendFile(filePath);
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 404,
      translationKey: "file_not",
      error: "File not found",
    });
  }
};

/**
 * Get File Details
 */
const getFileDetails = async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, "../uploads", filename);

    await fs.access(filePath);

    const mimeType = mime.lookup(filePath) || "application/octet-stream";

    const fileDetails = {
      filename,
      path: `${req.protocol}://${req.get("host")}/api/upload/${filename}`,
      mimeType,
      fileType: getFileType(mimeType),
    };

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "file_details",
      data: fileDetails,
    });
  } catch (error) {
    return sendResponse({
      res,
      statusCode: 404,
      translationKey: "file_not",
      error: "File not found",
    });
  }
};

/**
 * Get All Files
 */
const getAllFiles = async (req, res) => {
  try {
    const directoryPath = path.join(__dirname, "../uploads");

    const files = await fs.readdir(directoryPath);

    const fileDetails = files.map((file) => {
      const filePath = path.join(directoryPath, file);
      const mimeType = mime.lookup(filePath) || "application/octet-stream";

      return {
        filename: file,
        path: `${req.protocol}://${req.get("host")}/upload/${file}`,
        mimeType,
        fileType: getFileType(mimeType),
      };
    });

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "all_files",
      data: {
        files: fileDetails,
      },
    });
  } catch (error) {
    console.error("Get All Files Error:", error);

    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "unable_to",
      error: error.message,
    });
  }
};

/**
 * Delete File
 */
const deleteFile = async (req, res) => {
  try {
    const { fileKey } = req.body;

    if (!fileKey) {
      return sendResponse({
        res,
        statusCode: 400,
        translationKey: "file_key_required",
      });
    }

    const result = await deleteFromCloudinary(fileKey);

    return sendResponse({
      res,
      statusCode: 200,
      translationKey: "file_deleted",
      data: {
        message: "File deleted successfully",
        result: result?.result,
      },
    });
  } catch (error) {
    console.error("Delete File Error:", error);

    return sendResponse({
      res,
      statusCode: 500,
      translationKey: "error_deleting_file",
      error: error.message,
    });
  }
};

module.exports = {
  uploadFile,
  getFileByName,
  getFileDetails,
  getAllFiles,
  deleteFile,
};
