module.exports = {
    validatePhoneNumber: (phone) => {
      const cleaned = phone.replace(/[^0-9+]/g, "");
      return cleaned.match(/^\+?[1-9]\d{6,14}$/);
    },
  };