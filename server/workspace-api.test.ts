import {describe,it,expect} from 'vitest';
import {validateUpload,documentText} from './workspace-api.js';
describe('document upload boundary',()=>{
 it('rejects renamed executable content, unsupported formats and oversized documents',()=>{
  expect(()=>validateUpload('notes.pdf',Buffer.from('MZ executable'))).toThrow('contents');
  expect(()=>validateUpload('notes.exe',Buffer.from('%PDF-'))).toThrow('Choose');
  expect(()=>validateUpload('notes.pdf',Buffer.alloc(20000001))).toThrow('20 MB');
  expect(()=>validateUpload('notes.pdf',Buffer.alloc(0))).toThrow('nonempty');
 });
 it('accepts supported signatures and strips review metadata from the reader',()=>{
  expect(validateUpload('notes.pdf',Buffer.from('%PDF-1.7'))).toBe('.pdf');
  expect(validateUpload('notes.docx',Buffer.from([80,75,3,4]))).toBe('.docx');
  expect(validateUpload('photo.jpeg',Buffer.from([255,216,255]))).toBe('.jpeg');
  expect(documentText('---\nstatus: pending-review\nsource: local\n---\n\n# Notes\nText')).toBe('# Notes\nText');
 });
});
