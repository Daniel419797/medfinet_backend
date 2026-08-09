const TAGWRITER_DEMO_HARDWARE_FAMILY = 'NTAG_215_TAGWRITER_DEMO';
const TAGWRITER_DEMO_SCAN_MODE = 'TAGWRITER_NDEF';

function buildTagWriterDemoUrl(tapBaseUrl, publicId, cardToken) {
  return `${tapBaseUrl.replace(/\/$/, '')}/${publicId}#t=${cardToken}`;
}

function isTagWriterDemoBinding(binding) {
  return binding?.hardwareFamily === TAGWRITER_DEMO_HARDWARE_FAMILY;
}

module.exports = {
  TAGWRITER_DEMO_HARDWARE_FAMILY,
  TAGWRITER_DEMO_SCAN_MODE,
  buildTagWriterDemoUrl,
  isTagWriterDemoBinding,
};
