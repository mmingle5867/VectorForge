'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useDropzone } from 'react-dropzone';
import { formatBytes } from '@/lib/utils';

interface UploadedFile {
  id: string;
  originalFilename: string;
  baseName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  previewUrl: string;
}

export default function UploadPage() {
  const router = useRouter();
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback((acceptedFiles: File[], rejectedFiles: any[]) => {
    setError(null);

    if (rejectedFiles.length > 0) {
      setError('Some files were rejected. Only JPG, PNG, WebP, TIFF, and SVG are supported.');
    }

    if (acceptedFiles.length + selectedFiles.length > 50) {
      setError('Maximum 50 files per batch.');
      return;
    }

    setSelectedFiles((prev) => [...prev, ...acceptedFiles]);
  }, [selectedFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
      'image/webp': ['.webp'],
      'image/tiff': ['.tiff', '.tif'],
      'image/svg+xml': ['.svg'],
    },
    maxSize: 50 * 1024 * 1024, // 50MB
    maxFiles: 50,
  });

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    setError(null);
    setUploadProgress(0);

    try {
      const formData = new FormData();
      selectedFiles.forEach((file) => {
        formData.append('files', file);
      });

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setError(data.error || 'Upload failed');
        setIsUploading(false);
        return;
      }

      // Navigate to review screen
      router.push(`/upload/review/${data.batchId}`);
    } catch (err) {
      setError('Upload failed. Please try again.');
      setIsUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Upload Images</h1>
        <p className="mt-1 text-sm text-gray-600">
          Drag and drop up to 50 images for bulk vector conversion.
        </p>
      </div>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`relative cursor-pointer rounded-xl border-2 border-dashed p-12 text-center transition-colors ${
          isDragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
        }`}
      >
        <input {...getInputProps()} />
        <svg
          className="mx-auto h-12 w-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="mt-4 text-lg font-medium text-gray-700">
          {isDragActive ? 'Drop files here...' : 'Drag & drop images here'}
        </p>
        <p className="mt-2 text-sm text-gray-500">
          or click to browse • JPG, PNG, WebP, TIFF, SVG • Max 50MB each • Up to 50 files
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Selected Files List */}
      {selectedFiles.length > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Selected Files ({selectedFiles.length}/50)
            </h2>
            <button
              onClick={() => setSelectedFiles([])}
              className="text-xs text-red-600 hover:text-red-800"
            >
              Clear All
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-200">
            {selectedFiles.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="flex items-center justify-between border-b border-gray-100 px-4 py-2 last:border-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-8 w-8 flex-shrink-0 rounded bg-gray-100 flex items-center justify-center">
                    <svg className="h-4 w-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-800">{file.name}</p>
                    <p className="text-xs text-gray-500">{formatBytes(file.size)}</p>
                  </div>
                </div>
                <button
                  onClick={() => removeFile(index)}
                  className="ml-2 flex-shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          {/* Upload Button */}
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleUpload}
              disabled={isUploading}
              className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isUploading ? (
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Uploading...
                </span>
              ) : (
                `Upload ${selectedFiles.length} File${selectedFiles.length > 1 ? 's' : ''}`
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
