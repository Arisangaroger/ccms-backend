const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Complaint = require('../models/Complaint');
const mongoose = require('mongoose');

// Helper function to calculate resolution time in days
const calculateResolutionTime = (submissionDate, resolutionDate) => {
  return Math.ceil((resolutionDate - submissionDate) / (1000 * 60 * 60 * 24));
};

// Get all institutions with statistics
exports.getInstitutions = async (req, res) => {
  try {
    const institutions = await User.find({ role: 'institution' }).select('-password');
    
    // Get complaint statistics for each institution
    const institutionsWithStats = await Promise.all(
      institutions.map(async (institution) => {
        const complaints = await Complaint.find({ assignedTo: institution._id });
        const totalComplaints = complaints.length;
        const resolvedComplaints = complaints.filter(c => c.status === 'RESOLVED').length;
        const performance = totalComplaints > 0 ? (resolvedComplaints / totalComplaints) * 100 : 0;
        
        // Calculate average resolution time
        const resolvedComplaintsWithTime = complaints.filter(c => c.status === 'RESOLVED' && c.resolvedAt);
        const avgResolutionTime = resolvedComplaintsWithTime.length > 0
          ? resolvedComplaintsWithTime.reduce((acc, curr) => {
              const resolutionTime = curr.resolvedAt - curr.createdAt;
              return acc + (resolutionTime / (1000 * 60 * 60 * 24)); // Convert to days
            }, 0) / resolvedComplaintsWithTime.length
          : 0;

        return {
          ...institution.toObject(),
          totalComplaints,
          resolvedComplaints,
          performance: Math.round(performance),
          avgResolutionTime: Math.round(avgResolutionTime)
        };
      })
    );

    res.json(institutionsWithStats);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// Create a new institution
exports.createInstitution = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { institutionName, email, phone, password, province, district } = req.body;

  try {
    // Check if institution exists
    let institution = await User.findOne({ email });
    if (institution) {
      return res.status(400).json({ message: 'Institution already exists' });
    }

    // Create new institution
    institution = new User({
      role: 'institution',
      institutionName,
      email,
      phone,
      province,
      district
    });

    // Hash password
    const salt = await bcrypt.genSalt(10);
    institution.password = await bcrypt.hash(password, salt);

    await institution.save();

    // Return institution without password
    const { password: _, ...institutionData } = institution.toObject();
    res.json(institutionData);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// Update an institution
exports.updateInstitution = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const institution = await User.findById(req.params.id);
    if (!institution) {
      return res.status(404).json({ message: 'Institution not found' });
    }

    // Update fields
    const updateFields = ['institutionName', 'email', 'phone', 'province', 'district'];
    updateFields.forEach(field => {
      if (req.body[field] !== undefined) {
        institution[field] = req.body[field];
      }
    });

    await institution.save();

    // Return updated institution without password
    const { password: _, ...institutionData } = institution.toObject();
    res.json(institutionData);
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// Delete an institution
exports.deleteInstitution = async (req, res) => {
  try {
    const institution = await User.findById(req.params.id);
    if (!institution) {
      return res.status(404).json({ message: 'Institution not found' });
    }

    // Check if institution has any active complaints
    const activeComplaints = await Complaint.find({
      assignedTo: institution._id,
      status: { $in: ['PENDING', 'IN_PROGRESS'] }
    });

    if (activeComplaints.length > 0) {
      return res.status(400).json({
        message: 'Cannot delete institution with active complaints. Please reassign or resolve all complaints first.'
      });
    }

    await institution.remove();
    res.json({ message: 'Institution removed' });
  } catch (error) {
    console.error(error.message);
    res.status(500).send('Server Error');
  }
};

// List all complaints with filters
exports.getComplaints = async (req, res) => {
  try {
    const {
      status,
      category,
      district,
      province,
      fromDate,
      toDate,
      resolvedOnTime
    } = req.query;

    let query = {};

    // Apply filters
    if (status) query.status = status;
    if (category) query.category = category;
    if (district) query.district = district;
    if (province) query.province = province;

    // Date range filter
    if (fromDate || toDate) {
      query.submissionDate = {};
      if (fromDate) query.submissionDate.$gte = new Date(fromDate);
      if (toDate) query.submissionDate.$lte = new Date(toDate);
    }

    // Resolution time filter
    if (resolvedOnTime === 'true') {
      query.resolutionDate = { $lte: '$resolutionDeadline' };
    } else if (resolvedOnTime === 'false') {
      query.resolutionDate = { $gt: '$resolutionDeadline' };
    }

    const complaints = await Complaint.find(query)
      .populate('citizenId', 'fullName email')
      .populate('institutionId', 'institutionName')
      .populate('assignedDepartment', 'name')
      .sort({ submissionDate: -1 });

    res.json({
      count: complaints.length,
      complaints
    });
  } catch (error) {
    console.error('Error fetching complaints:', error);
    res.status(500).json({
      message: 'Error fetching complaints',
      error: error.message
    });
  }
};

// Get institution performance rankings
exports.getPerformance = async (req, res) => {
  try {
    const { timeframe } = req.query; // 'week', 'month', 'year'
    
    let dateFilter = {};
    const now = new Date();
    
    switch (timeframe) {
      case 'week':
        dateFilter = {
          $gte: new Date(now.setDate(now.getDate() - 7))
        };
        break;
      case 'month':
        dateFilter = {
          $gte: new Date(now.setMonth(now.getMonth() - 1))
        };
        break;
      case 'year':
        dateFilter = {
          $gte: new Date(now.setFullYear(now.getFullYear() - 1))
        };
        break;
      default:
        dateFilter = {}; // All time
    }

    // Aggregate performance metrics
    const performance = await Complaint.aggregate([
      {
        $match: {
          submissionDate: dateFilter
        }
      },
      {
        $group: {
          _id: '$institutionId',
          totalComplaints: { $sum: 1 },
          resolvedComplaints: {
            $sum: {
              $cond: [{ $eq: ['$status', 'RESOLVED'] }, 1, 0]
            }
          },
          resolvedOnTime: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'RESOLVED'] },
                    { $lte: ['$resolutionDate', '$resolutionDeadline'] }
                  ]
                },
                1,
                0
              ]
            }
          },
          averageResolutionTime: {
            $avg: {
              $cond: [
                { $eq: ['$status', 'RESOLVED'] },
                {
                  $divide: [
                    { $subtract: ['$resolutionDate', '$submissionDate'] },
                    1000 * 60 * 60 * 24 // Convert to days
                  ]
                },
                null
              ]
            }
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'institution'
        }
      },
      {
        $unwind: '$institution'
      },
      {
        $project: {
          institutionName: '$institution.institutionName',
          district: '$institution.district',
          province: '$institution.province',
          totalComplaints: 1,
          resolvedComplaints: 1,
          resolvedOnTime: 1,
          averageResolutionTime: { $round: ['$averageResolutionTime', 1] },
          resolutionRate: {
            $multiply: [
              { $divide: ['$resolvedComplaints', '$totalComplaints'] },
              100
            ]
          },
          onTimeResolutionRate: {
            $multiply: [
              {
                $divide: [
                  '$resolvedOnTime',
                  { $max: ['$resolvedComplaints', 1] }
                ]
              },
              100
            ]
          }
        }
      },
      {
        $sort: { onTimeResolutionRate: -1 }
      }
    ]);

    // Calculate system-wide statistics
    const totalComplaints = performance.reduce((sum, p) => sum + p.totalComplaints, 0);
    const totalResolved = performance.reduce((sum, p) => sum + p.resolvedComplaints, 0);
    const totalResolvedOnTime = performance.reduce((sum, p) => sum + p.resolvedOnTime, 0);

    const systemStats = {
      totalComplaints,
      totalResolved,
      totalResolvedOnTime,
      systemResolutionRate: totalComplaints ? (totalResolved / totalComplaints) * 100 : 0,
      systemOnTimeRate: totalResolved ? (totalResolvedOnTime / totalResolved) * 100 : 0
    };

    res.json({
      timeframe: timeframe || 'all-time',
      systemStats,
      institutionPerformance: performance
    });
  } catch (error) {
    console.error('Error fetching performance data:', error);
    res.status(500).json({
      message: 'Error fetching performance data',
      error: error.message
    });
  }
}; 