const getAllCards = "SELECT * FROM tntyugioh";
const insertCards =
  "INSERT INTO tntyugioh(id, name, imagesource, edition, prices, link) VALUES(DEFAULT, $1, $2, $3, $4, $5) RETURNING *";
const deleteOldCards = "DELETE FROM public.tntyugioh WHERE id > $1";

//userwatchlist table
const getUserWatchList = "SELECT * FROM userwatchlist WHERE email = $1";
const getAllWatchLists = "SELECT * FROM userwatchlist";

module.exports = {
  getAllCards,
  insertCards,
  deleteOldCards,
  getUserWatchList,
  getAllWatchLists,
};
