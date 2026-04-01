import { Pagination } from "react-bootstrap";
import { buildVisiblePages } from "./listing.helpers";

const ListingPagination = ({ pagination = {}, onPageChange }) => {
  const totalPages = Math.max(1, Number(pagination.totalPages || 1));
  const currentPage = Math.max(1, Number(pagination.page || 1));
  const visiblePages = buildVisiblePages({ page: currentPage, totalPages });

  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="listing-pagination-wrap">
      <Pagination className="listing-pagination mb-0">
        <Pagination.Prev
          disabled={!pagination.hasPrevPage}
          onClick={() => onPageChange(currentPage - 1)}
        />

        {visiblePages[0] > 1 ? (
          <>
            <Pagination.Item onClick={() => onPageChange(1)}>1</Pagination.Item>
            {visiblePages[0] > 2 ? <Pagination.Ellipsis disabled /> : null}
          </>
        ) : null}

        {visiblePages.map((page) => (
          <Pagination.Item
            key={page}
            active={page === currentPage}
            onClick={() => onPageChange(page)}
          >
            {page}
          </Pagination.Item>
        ))}

        {visiblePages[visiblePages.length - 1] < totalPages ? (
          <>
            {visiblePages[visiblePages.length - 1] < totalPages - 1 ? (
              <Pagination.Ellipsis disabled />
            ) : null}
            <Pagination.Item onClick={() => onPageChange(totalPages)}>{totalPages}</Pagination.Item>
          </>
        ) : null}

        <Pagination.Next
          disabled={!pagination.hasNextPage}
          onClick={() => onPageChange(currentPage + 1)}
        />
      </Pagination>
    </div>
  );
};

export default ListingPagination;
