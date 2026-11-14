#pragma once
#include <vector>
template <class T> class Index : public std::vector<T> {
public:
    using std::vector<T>::vector;
    T *begin() { return this->data(); }
    int len() const { return this->size(); }
};
