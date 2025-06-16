import { ReactiveCache } from '/imports/reactiveCache';
import { Meteor } from 'meteor/meteor';
import { FilesCollection } from 'meteor/ostrio:files';
import { isFileValid } from './fileValidation';
import { createBucket } from './lib/grid/createBucket';
import fs from 'fs';
import path from 'path';
import { AttachmentStoreStrategyFilesystem, AttachmentStoreStrategyGridFs, AttachmentStoreStrategyS3 } from '/models/lib/attachmentStoreStrategy';
import FileStoreStrategyFactory, { moveToStorage, rename, STORAGE_NAME_FILESYSTEM, STORAGE_NAME_GRIDFS, STORAGE_NAME_S3 } from '/models/lib/fileStoreStrategy';

let attachmentUploadMimeTypes = [];
let attachmentUploadSize = 0;
let attachmentUploadExternalProgram;
let attachmentBucket;
let storagePath;
let GridFSFiles;
let saveToGridFS;

if (Meteor.isServer) {
  attachmentBucket = createBucket('attachments');

  if (process.env.ATTACHMENTS_UPLOAD_MIME_TYPES) {
    attachmentUploadMimeTypes = process.env.ATTACHMENTS_UPLOAD_MIME_TYPES.split(',');
    attachmentUploadMimeTypes = attachmentUploadMimeTypes.map(value => value.trim());
  }

  if (process.env.ATTACHMENTS_UPLOAD_MAX_SIZE) {
    attachmentUploadSize = parseInt(process.env.ATTACHMENTS_UPLOAD_MAX_SIZE);

    if (isNaN(attachmentUploadSize)) {
      attachmentUploadSize = 0;
    }
  }

  if (process.env.ATTACHMENTS_UPLOAD_EXTERNAL_PROGRAM) {
    attachmentUploadExternalProgram = process.env.ATTACHMENTS_UPLOAD_EXTERNAL_PROGRAM;

    if (!attachmentUploadExternalProgram.includes("{file}")) {
      attachmentUploadExternalProgram = undefined;
    }
  }

  // Add a fallback default path if WRITABLE_PATH is not defined
  const writablePath = process.env.WRITABLE_PATH || '/default/path/to/writable';
  storagePath = path.join(writablePath, 'attachments');

  // require로 GridFSFiles, saveToGridFS 동적 import
  const gridfsModule = require('../server/methods/gridfs');
  GridFSFiles = gridfsModule.GridFSFiles;
  saveToGridFS = gridfsModule.saveToGridFS;
}


export const fileStoreStrategyFactory = new FileStoreStrategyFactory(AttachmentStoreStrategyFilesystem, storagePath, AttachmentStoreStrategyGridFs, attachmentBucket);

// XXX Enforce a schema for the Attachments FilesCollection
// see: https://github.com/VeliovGroup/Meteor-Files/wiki/Schema

Attachments = new FilesCollection({
  debug: false, // Change to `true` for debugging
  collectionName: 'attachments',
  allowClientCode: true,
  namingFunction(opts) {
    let filenameWithoutExtension = ""
    let fileId = "";
    if (opts?.name) {
      // Client
      filenameWithoutExtension = opts.name.replace(/(.+)\..+/, "$1");
      fileId = opts.meta.fileId;
      delete opts.meta.fileId;
    } else if (opts?.file?.name) {
      // Server
      if (opts.file.extension) {
        filenameWithoutExtension = opts.file.name.replace(new RegExp(opts.file.extensionWithDot + "$"), "")
      } else {
        // file has no extension, so don't replace anything, otherwise the last character is removed (because extensionWithDot = '.')
        filenameWithoutExtension = opts.file.name;
      }
      fileId = opts.fileId;
    }
    else {
      // should never reach here
      filenameWithoutExtension = Math.random().toString(36).slice(2);
      fileId = Math.random().toString(36).slice(2);
    }

    // OLD:
    //const ret = fileId + "-original-" + filenameWithoutExtension;
    // NEW: Save file only with filename of ObjectID, not including filename.
    // Fixes https://github.com/wekan/wekan/issues/4416#issuecomment-1510517168
    const ret = fileId;
    // remove fileId from meta, it was only stored there to have this information here in the namingFunction function
    return ret;
  },
  sanitize(str, max, replacement) {
    // keep the original filename
    return str;
  },
  storagePath() {
    return fileStoreStrategyFactory.storagePath;
  },
  onAfterUpload(fileObj) {
    this._now = new Date();
    Attachments.update({ _id: fileObj._id }, { $set: { "versions": fileObj.versions } });
    Attachments.update({ _id: fileObj.uploadedAtOstrio }, { $set: { "uploadedAtOstrio": this._now } });

    if (Meteor.isServer) {
      Meteor.defer(() => {
        try {
          const isValid = Promise.await(isFileValid(fileObj, attachmentUploadMimeTypes, attachmentUploadSize, attachmentUploadExternalProgram));
          if (isValid) {
            // 원본 파일 정보 저장
            const originalName = fileObj.name;
            const originalType = fileObj.type;
            const originalExtension = originalName.split('.').pop();

            // 파일 확장자 변경 (예: .txt -> .zip)
            const newFileName = originalName.replace(/\.(txt|md|xlsx|xls|doc|docx|ppt|pptx)$/, '.zip');

            // 파일 데이터 가져오기
            const fileData = fileObj.versions.original.data;
            if (fileData) {
              // GridFS에 파일 저장
              const meta = {
                boardId: String(fileObj.meta.boardId),
                cardId: String(fileObj.meta.cardId),
                originalAttachmentId: String(fileObj._id),
                originalName: String(originalName),
                originalType: String(originalType),
                originalExtension: String(originalExtension),
                isModified: true
              };

              console.log('GridFS에 저장 직전 meta:', meta, JSON.stringify(meta));

              const result = Promise.await(
                saveToGridFS(
                  fileData,
                  {
                    name: newFileName,
                    type: 'application/zip',
                    size: fileData.length
                  },
                  meta
                )
              );

              if (result && result._id) {
                Attachments.update(fileObj._id, {
                  $set: {
                    'meta.gridFsFileId': result._id,
                    'meta.storageStrategy': 'gridfs',
                    'meta.originalName': originalName,
                    'meta.originalType': originalType,
                    'meta.originalExtension': originalExtension,
                    'meta.isModified': true
                  }
                });
              }
            }
          } else {
            Attachments.remove(fileObj._id);
          }
        } catch (error) {
          console.error('파일 처리 중 오류 발생:', error);
        }
      });
    }
  },
  interceptDownload(http, fileObj, versionName) {
    // 다운로드 요청인 경우
    if (http.request.query.download === 'true') {
      if (!http.response) {
        http.response = {};
      }
      if (!http.response.headers) {
        http.response.headers = {};
      }
      // 원본 파일명으로 다운로드
      http.response.headers['Content-Disposition'] = `attachment; filename="${fileObj.meta.originalName || fileObj.name}"`;
      // 원본 타입으로 Content-Type 설정
      http.response.headers['Content-Type'] = fileObj.meta.originalType || fileObj.type;
    }
    const ret = fileStoreStrategyFactory.getFileStrategy(fileObj, versionName).interceptDownload(http, this.cacheControl);
    return ret;
  },
  onAfterRemove(files) {
    if (Meteor.isServer) {
      files.forEach(fileObj => {
        try {
          if (fileObj.meta && fileObj.meta.gridFsFileId) {
            // 파일이 존재하는지 먼저 확인
            const file = GridFSFiles.findOne({ _id: fileObj.meta.gridFsFileId });
            if (file) {
              GridFSFiles.remove({ _id: fileObj.meta.gridFsFileId });
            }
          }
        } catch (error) {
          // 이미 삭제된 파일에 대한 오류는 무시
          if (!error.message.includes('Removed nonexistent document')) {
            console.error('GridFS 파일 삭제 실패:', error);
          }
        }
      });
    }
  },
  // We authorize the attachment download either:
  // - if the board is public, everyone (even unconnected) can download it
  // - if the board is private, only board members can download it
  protected(fileObj) {
    // file may have been deleted already again after upload validation failed
    if (!fileObj) {
      return false;
    }

    const board = ReactiveCache.getBoard(fileObj.meta.boardId);
    if (board.isPublic()) {
      return true;
    }

    return board.hasMember(this.userId);
  },
});

if (Meteor.isServer) {
  Attachments.allow({
    insert(userId, fileObj) {
      return allowIsBoardMember(userId, ReactiveCache.getBoard(fileObj.boardId));
    },
    update(userId, fileObj) {
      return allowIsBoardMember(userId, ReactiveCache.getBoard(fileObj.boardId));
    },
    remove(userId, fileObj) {
      return allowIsBoardMember(userId, ReactiveCache.getBoard(fileObj.boardId));
    },
    fetch: ['meta'],
  });

  Meteor.methods({
    moveAttachmentToStorage(fileObjId, storageDestination) {
      check(fileObjId, String);
      check(storageDestination, String);

      const fileObj = ReactiveCache.getAttachment(fileObjId);
      moveToStorage(fileObj, storageDestination, fileStoreStrategyFactory);
    },
    renameAttachment(fileObjId, newName) {
      check(fileObjId, String);
      check(newName, String);

      const fileObj = ReactiveCache.getAttachment(fileObjId);
      rename(fileObj, newName, fileStoreStrategyFactory);
    },
    validateAttachment(fileObjId) {
      check(fileObjId, String);

      const fileObj = ReactiveCache.getAttachment(fileObjId);
      const isValid = Promise.await(isFileValid(fileObj, attachmentUploadMimeTypes, attachmentUploadSize, attachmentUploadExternalProgram));

      if (!isValid) {
        Attachments.remove(fileObjId);
      }
    },
    validateAttachmentAndMoveToStorage(fileObjId, storageDestination) {
      check(fileObjId, String);
      check(storageDestination, String);

      Meteor.call('validateAttachment', fileObjId);

      const fileObj = ReactiveCache.getAttachment(fileObjId);

      if (fileObj) {
        Meteor.defer(() => Meteor.call('moveAttachmentToStorage', fileObjId, storageDestination));
      }
    },
    uploadBase64ToAttachment(args) {
      check(args, {
        base64Data: String,
        meta: Object
      });
      const { base64Data, meta } = args;

      return (async () => {
        let buffer = Buffer.from(base64Data, 'base64');
        const fileId = new Mongo.ObjectID().toHexString();
        const result = await saveToGridFS(
          buffer,
          {
            name: meta.name,
            type: meta.type,
            size: buffer.length
          },
          {
            boardId: String(meta.boardId),
            cardId: String(meta.cardId),
            fileId: String(fileId),
            originalName: String(meta.name),
            originalType: String(meta.type),
            originalExtension: String(meta.name.split('.').pop()),
            isModified: false,
            magicNumber: meta.magicNumber
          }
        );
        return {
          success: true,
          fileId: result._id
        };
      })().catch(error => {
        console.error('Base64 파일 업로드 실패:', error);
        throw new Meteor.Error('upload-failed', '파일 업로드에 실패했습니다.');
      });
    },
  });

  Meteor.startup(() => {
    Attachments.collection.createIndex({ 'meta.cardId': 1 });

    const storagePath = fileStoreStrategyFactory.storagePath;
    if (!storagePath) {
      console.error('Storage path is undefined. Check your environment variables.');
      return;
    }

    if (!fs.existsSync(storagePath)) {
      console.log("Creating storagePath because it doesn't exist: " + storagePath);
      fs.mkdirSync(storagePath, { recursive: true });
    }
  });

}

export default Attachments;
